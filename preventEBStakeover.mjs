import { ElasticBeanstalkClient, RebuildEnvironmentCommand } from '@aws-sdk/client-elastic-beanstalk'
import { Route53Client, ListHostedZonesCommand, ListResourceRecordSetsCommand, ChangeResourceRecordSetsCommand } from '@aws-sdk/client-route-53'
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'

const elasticBeanstalkClient = new ElasticBeanstalkClient({});
const domainClient = new Route53Client({});
const sesClient = new SESClient({});
const EBS_REGEX = ".elasticbeanstalk.com";

var sanitizeDomain = function (domain) {
  if (domain.charAt(domain.length - 1) === '.') {
    domain = domain.substring(0, domain.length - 1);
  }
  return domain;
};

async function sendSuccessEmail(cname, environmentName) {
  // Email Content
  const params = {
    Destination: {
      ToAddresses: ['ENTER_RECEIVER_EMAIL_ADDRESS']
    },
    Message: {
      Body: {
        Text: {
          Data: 'Rebuilt ElasticBeanStalk environment ' + environmentName + ' to prevent subdomain takeover of domain ' + cname
        }
      },
      Subject: {
        Data: 'Action Required: EBS Subdomain Takeover Prevented'
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



async function rebuildEnvironment(environmentId, environmentName, cname, record) {
  try {
    const rebuildEnvironmentCommand = new RebuildEnvironmentCommand({ EnvironmentId: environmentId, EnvironmentName: environmentName });
    await elasticBeanstalkClient.send(rebuildEnvironmentCommand);
    console.log('Environment restored successfully:', environmentName);
    await sendSuccessEmail(cname, environmentName);
  } catch (error) {
    console.error('Error restoring environment:', error);
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


async function checkCNAMEDangling(deletedSubdomainCname) {
  if (!deletedSubdomainCname) {
    return false;
  }
  const listHostedZonesCommand = new ListHostedZonesCommand({});
  let hostedZones = await domainClient.send(listHostedZonesCommand);

  var danglingCNAME = [];

  for (let hostedZone of hostedZones.HostedZones) {
    if (danglingCNAME.length > 0)
      break;

    const listResourceRecordSetsCommand = new ListResourceRecordSetsCommand({ HostedZoneId: hostedZone.Id });
    let resourceRecordSets = await domainClient.send(listResourceRecordSetsCommand);

    for (let record of resourceRecordSets.ResourceRecordSets) {
      if (["CNAME"].includes(record.Type)) {
        let recordName = sanitizeDomain(record.Name);
        var values = [];
        if (record.AliasTarget) {
          values.push(record.AliasTarget.DNSName);
        } else if (record.ResourceRecords.map(resource => resource.Value)) {
          values = record.ResourceRecords.map(resource => resource.Value);
        }

        var ebsValues = values.filter(value => value.endsWith(EBS_REGEX));

        if (ebsValues && ebsValues.length > 0) {
          values = ebsValues;
        } else {
          values = [];
        }

        for (let value of values) {
          if (value == deletedSubdomainCname) {
            danglingCNAME.push(record);
            break;
          }
        }
      }
    }
  }

  return danglingCNAME;
}

export const handler = async (event) => {
  var deletedEnvironmentName = event.detail.responseElements.environmentName;
  var deletedSubdomainCname = event.detail.responseElements.cNAME;
  var deletedEnvironmentId = event.detail.responseElements.environmentId;

  // check if cname is a dangling resource
  let danglingCNAMERecords = await checkCNAMEDangling(deletedSubdomainCname);

  if (danglingCNAMERecords.length === 0) {
    console.log("Environment CNAME is not dangling, exiting...");
    return;
  }

  await rebuildEnvironment(deletedEnvironmentId, deletedEnvironmentName, deletedSubdomainCname, danglingCNAMERecords[0]);

};
