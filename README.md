These are codes for three separate [AWS lambda]([url](https://aws.amazon.com/pm/lambda/)) functions.

## Permissions Required
These permissions can be set by creating appropriate IAM roles and associating them with the lambda function. We created three separate lambda functions for Amazon S3 deletion, AWS Elastic Beanstalk environment termination and dangling IP detection. We chose the environment runtime as **Node.js 20.x** and the instruction set architecture as **x86\_64**.
| AWS Components | Permissions |
|---|---|
| AWS Lambda: S3 | route53:*  
| | ses:*  
| | logs:CreateLogGroup  
| | logs:CreateLogStream  
| | logs:PutLogEvents  
| | s3:createBucket  
| | s3:Get*  
| | s3:List*  
| | s3:Describe*  
| | s3-object-lambda:Get*  
| | s3-object-lambda:List*  
| AWS Lambda: EBS | route53:*  
| | ses:*  
| | logs:CreateLogGroup  
| | logs:CreateLogStream  
| | logs:PutLogEvents  
| | AdministratorAccess-AWSElasticBeanstalk  
| AWS Lambda: IP | route53:*  
| | ses:*  
| | logs:CreateLogGroup  
| | logs:CreateLogStream  
| | logs:PutLogEvents  
| | ec2:AmazonEC2ReadOnlyAccess  

## AWS Step function
Create a Step function with a wait state of the desired wait time and associate it with the lambda function. (Not for dangling IPs)
```json
{
  "Comment": "desciption",
  "StartAt": "Wait",
  "States": {
    "Wait": {
      "Type": "Wait",
      "Seconds": {mention wait seconds here},
      "Next": "Lambda Invoke"
    },
    "Lambda Invoke": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "OutputPath": "$.Payload",
      "Parameters": {
        "Payload.$": "$",
        "FunctionName": {mention lambda function arn here}
      },
      "Retry": [
        {
          "ErrorEquals": [
            "Lambda.ServiceException",
            "Lambda.AWSLambdaException",
            "Lambda.SdkClientException",
            "Lambda.TooManyRequestsException"
          ],
          "IntervalSeconds": 1,
          "MaxAttempts": 3,
          "BackoffRate": 2
        }
      ],
      "End": true
    }
  }
}
```


## EventBridge rules
Create EventBridge rules with the mentioned event and associate them with the appropriate step function (or lambda function in case of dangling IP)
- Amazon S3 bucket deletion event:
```JSON
{
  "source": ["aws.s3"],
  "detail-type": 
    ["AWS API Call via CloudTrail"],
  "detail": {
    "eventSource": ["s3.amazonaws.com"],
    "eventName": ["DeleteBucket"]
  }
}
```
- AWS Elastic Beanstalk environment deletion event:
```JSON
{
  "source": ["aws.elasticbeanstalk"],
  "detail-type": 
    ["AWS API Call via CloudTrail"],
  "detail": {
    "eventSource": 
      ["elasticbeanstalk.amazonaws.com"],
    "eventName": ["TerminateEnvironment"]
  }
}
```
- IP dangling event:
```JSON
{
  "source": ["aws.ec2"],
  "detail-type": ["EC2 Instance State-change Notification"],
  "detail": {
    "state": ["terminated", "stopped"]
  }
}
```
```JSON
{
  "source": ["aws.cloudtrail"],
  "detail-type": ["AWS API Call via CloudTrail"],
  "detail": {
    "eventSource": ["cloudtrail.amazonaws.com"],
    "eventName": ["ReleaseAddress"]
  }
}
```
```JSON
{
  "source": ["aws.cloudtrail"],
  "detail-type": ["AWS API Call via CloudTrail"],
  "detail": {
    "eventSource": ["cloudtrail.amazonaws.com"],
    "eventName": ["ModifyVpcEndpoint"]
  }
}
```
```JSON
{
  "source": ["aws.cloudtrail"],
  "detail-type": ["AWS API Call via CloudTrail"],
  "detail": {
    "eventSource": ["cloudtrail.amazonaws.com"],
    "eventName": ["AssociateAddress"]
  }
}
```
