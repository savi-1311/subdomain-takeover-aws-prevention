import { Route53Client, ListHostedZonesCommand, ListResourceRecordSetsCommand, ChangeResourceRecordSetsCommand } from '@aws-sdk/client-route-53'
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import { EC2Client, DescribeAddressesCommand, DescribeNetworkInterfacesCommand } from '@aws-sdk/client-ec2'
import { reverse } from 'dns'

const domainClient = new Route53Client({});
const sesClient = new SESClient({});
const eC2Client = new EC2Client({});

function isIPv4(ipAddress) {
  const pattern = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return pattern.test(ipAddress);
}


var sanitizeDomain = function (domain) {
  if (domain.charAt(domain.length - 1) === '.') {
    domain = domain.substring(0, domain.length - 1);
  }
  return domain;
};

function reverseWrapper(ip) {
  return new Promise((resolve, reject) => {
    reverse(ip, (errorResponse, successResponse) => {
      if (errorResponse) {
        reject(errorResponse);
      } else {
        resolve(successResponse);
      }
    });
  });
}

async function deleteRecord(record, hostedZoneId) {
  try {
    const params = {
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: 'DELETE',
            ResourceRecordSet: record,
          },
        ],
      },
    };

    const changeResourceRecordSetsCommand = new ChangeResourceRecordSetsCommand(params);
    await domainClient.send(changeResourceRecordSetsCommand);

    console.log(`Record '${record.Name}' (type: ${record.Type}) deleted successfully from hosted zone ${hostedZoneId}`);
    var emailMsg = `Record '${record.Name}' (type: ${record.Type}) deleted successfully from hosted zone ${hostedZoneId}`;
    await sendSuccessEmail(emailMsg);
  } catch (error) {
    console.error("Error deleting record:", error);
  }
}

async function sendSuccessEmail(emailMsg) {
  // Email Content
  const params = {
    Destination: {
      ToAddresses: ['shambhavishandilya01@gmail.com']
    },
    Message: {
      Body: {
        Text: {
          Data: emailMsg
        }
      },
      Subject: {
        Data: 'Action Required: Subdomain Takeover Prevented'
      }
    },
    Source: 'mail@shambhavi.link'
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


async function checkIPExists(awsOwnedIP) {
  const describeAddressesCommand = new DescribeAddressesCommand({});
  const describeNetworkInterfacesCommand = new DescribeNetworkInterfacesCommand({});
  let existingIPs = [];
  let danglingIPs = [];

  let elasticIPs = await eC2Client.send(describeAddressesCommand);
  elasticIPs = elasticIPs.Addresses;
  for (var i = 0; i < elasticIPs.length; i++) {
    existingIPs.push(elasticIPs[i].PublicIp);
  }

  let networkAssociations = await eC2Client.send(describeNetworkInterfacesCommand);
  networkAssociations = networkAssociations.NetworkInterfaces;
  for (var i = 0; i < networkAssociations.length; i++) {
    let association = networkAssociations[i].Association;
    if (association.PublicIp) {
      existingIPs.push(association.PublicIp);
    }
  }

  for (var i = 0; i < awsOwnedIP.length; i++) {
    if (!existingIPs.find(ip => ip === awsOwnedIP[i].ip)) {
      danglingIPs.push(awsOwnedIP[i]);
    }
  }

  return danglingIPs;
}


async function checkIPDangling() {
  const listHostedZonesCommand = new ListHostedZonesCommand({});
  let hostedZones = await domainClient.send(listHostedZonesCommand);

  var danglingIP = [];

  for (let hostedZone of hostedZones.HostedZones) {
    if (danglingIP.length > 0)
      break;

    const listResourceRecordSetsCommand = new ListResourceRecordSetsCommand({ HostedZoneId: hostedZone.Id });
    let resourceRecordSets = await domainClient.send(listResourceRecordSetsCommand);
    var awsOwnedIP = [];

    for (let record of resourceRecordSets.ResourceRecordSets) {
      if (["A"].includes(record.Type)) {
        var values = [];
        if (record.AliasTarget) {
          values.push(record.AliasTarget.DNSName);
        } else if (record.ResourceRecords.map(resource => resource.Value)) {
          values = record.ResourceRecords.map(resource => resource.Value);
        }

        for (let ip of values) {
          if (isIPv4(ip)) {
            try {
              var hostnames = await reverseWrapper(ip);
              for (var i = 0; i < hostnames.length; i++) {
                var hostname = hostnames[i];
                if (hostname.includes("ec2") || hostname.includes("amazonaws")) {
                  awsOwnedIP.push({
                    "ip": ip,
                    "record": record,
                    "hostedZoneId": hostedZone.Id
                  });
                  break;
                }
              }
            } catch (err) {
              console.log("Error in fetching reverse DNS" + err);
            }
          }
        }
      }
    }
  }
  danglingIP = await checkIPExists(awsOwnedIP);
  for (var i = 0; i < danglingIP.length; i++) {
    await deleteRecord(danglingIP[i].record, danglingIP[i].hostedZoneId);
  }
  return danglingIP;
}

export const handler = async (event) => {
  console.log("started");

  var danglingARecords = await checkIPDangling();

  if (danglingARecords.length === 0) {
    console.log("IP are not dangling, exiting...");
    return;
  }

  console.log(danglingARecords);
  return;

};