import { S3Client, ListBucketsCommand, CreateBucketCommand } from '@aws-sdk/client-s3'
import { Route53Client, ListHostedZonesCommand, ListResourceRecordSetsCommand, ChangeResourceRecordSetsCommand } from '@aws-sdk/client-route-53'
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'

const s3Client = new S3Client({});
const domainClient = new Route53Client({});
const sesClient = new SESClient({});
const S3_REGEX = ".*s3(\\.|-).*amazonaws\\.com";

var sanitizeDomain = function (domain) {
  if (domain.charAt(domain.length - 1) === '.') {
    domain = domain.substring(0, domain.length - 1);
  }
  return domain;
};

async function sendSuccessEmail(bucketName) {
  // Email Content
  const params = {
    Destination: {
      ToAddresses: ['ENTER_RECEIVER_EMAIL_ADDRESS']
    },
    Message: {
      Body: {
        Text: {
          Data: 'Created S3 bucket ' + bucketName + ' to prevent subdomain takeover.\nTo enable uninterrupted service, please update the contents and configuration of the new bucket to host the website\'s content.'
        }
      },
      Subject: {
        Data: 'Action Required: Subdomain Takeover Prevented'
      }
    },
    Source: 'ENTER_SENDER_EMAIL_ADDRESS'
  };
  console.log(params);
  const sendEmailCommand = new SendEmailCommand({ Source: params.Source, Destination: params.Destination, Message: params.Message });
  console.log(sendEmailCommand);
  try {
    await sesClient.send(sendEmailCommand);
  }
  catch (error) {
    console.log("Error while sending email:" + error);
  }
};



async function createBucket(bucketName, record) {
  try {
    const createBucketCommand = new CreateBucketCommand({ Bucket: bucketName });
    await s3Client.send(createBucketCommand);
    console.log('Bucket created successfully:', bucketName);
    await sendSuccessEmail(bucketName);
  } catch (error) {
    console.error('Error creating bucket:', error);
    const changeResourceRecordSetsCommand = new ChangeResourceRecordSetsCommand({
      HostedZoneId: record.HostedZoneId, ChangeBatch:
        { Actions: ["DELETE"], Changes: [{ Action: "DELETE", ResourceRecordSet: record }] }
    });
    try {
      await domainClient.send(changeResourceRecordSetsCommand);
      console.log('Record deleted successfully:', record.Name);
    } catch (error) {
      console.error('Error deleting record:', error);
    }
  }
}


async function checkBucketDangling(deletedBucketName) {
  const listHostedZonesCommand = new ListHostedZonesCommand({});
  let hostedZones = await domainClient.send(listHostedZonesCommand);

  var danglingBucket = [];

  for (let hostedZone of hostedZones.HostedZones) {
    if (danglingBucket.length > 0)
      break;

    const listResourceRecordSetsCommand = new ListResourceRecordSetsCommand({ HostedZoneId: hostedZone.Id });
    let resourceRecordSets = await domainClient.send(listResourceRecordSetsCommand);

    for (let record of resourceRecordSets.ResourceRecordSets) {
      if (["A", "CNAME"].includes(record.Type)) {
        let recordName = sanitizeDomain(record.Name);
        var values = [];
        if (record.AliasTarget) {
          values.push(record.AliasTarget.DNSName);
        } else if (record.ResourceRecords.map(resource => resource.Value)) {
          values = record.ResourceRecords.map(resource => resource.Value);
        }

        var s3Values = values.filter(value => value.match(S3_REGEX));

        if (s3Values && s3Values.length > 0) {
          values = s3Values;
        } else {
          values = [];
        }

        for (let value of values) {
          var originBucket = recordName;
          if (originBucket === deletedBucketName) {
            danglingBucket.push(record);
            break;
          }
        }
      }
    }
  }

  return danglingBucket;
}

export const handler = async (event) => {
  return;
  var deletedBucketName = event.detail.requestParameters.bucketName;

  // check if bucket is a dangling resource
  let bucketDanglingRecords = await checkBucketDangling(deletedBucketName);

  if (bucketDanglingRecords.length === 0) {
    console.log("Bucket is not dangling, exiting...");
    return;
  }

  // checking if bucket has already been recreated
  const listBucketsCommand = new ListBucketsCommand({});
  let existingBuckets = await s3Client.send(listBucketsCommand);
  if (!existingBuckets.Buckets.find(bucket => bucket.Name === deletedBucketName.toLowerCase())) {
    console.log("Bucket does not exist, creating bucket...");
    await createBucket(deletedBucketName, bucketDanglingRecords[0]);
  }

};
