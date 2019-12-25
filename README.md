# Serverless Resource Names Plugin

This plugin generate resources names from your resource references in `Resources:`

## Setup

Install via npm or yarn in the root of your Serverless project:

```
npm install serverless-resource-names --save-dev
```

or

```
yarn add serverless-resource-names --dev
```

### Apply plugin

```yml
plugins:
  - serverless-resource-names
```

## Why?

Suppose you have one or many resources in your `serverless.yml` like so:

```yml
Resources:
  SomeQueueOne:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: ${self:service.name}-some-queue-one-${self:provider.stage}
      ...

  SomeQueueTwo:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: ${self:service.name}-some-queue-two-${self:provider.stage}
      ...

  UploadBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: ${self:service.name}-upload-bucket-${self:provider.stage}
      ...
```

**Notice how you have to constantly specify names for these services?**

Futhermore you're likley to use them in your enviroment variables as well

```yml
provider:
  environment:
    SOME_QUEUE_ONE: ${self:service.name}-some-queue-one-${self:provider.stage}
    SOME_QUEUE_TWO: ${self:service.name}-some-queue-two-${self:provider.stage}
    UPLOAD_BUCKET: ${self:service.name}-upload-bucket-${self:provider.stage}
```

This becomes very troublesome to manage when your resources grow and you'll constantly need to add these things

## What does it do?

To solve this problem this plugin generates the eqvivalent resources names by looking at the reference names in you're `serverless.yml`

So now you can omit the `BucketName` (or other name properties for other resources)

So the following resource...

```yml
UploadBucket:
  Type: AWS::S3::Bucket
  Properties: ...
```

...will generate the following based on the reference `UploadBucket`:

```yml
UploadBucket:
  Type: AWS::S3::Bucket
  Properties:
    BucketName: service-name-upload-bucket-dev
```

```yml
functions:
  hello:
    environment:
      UPLOAD_BUCKET: service-name-upload-bucket-dev
      ...
    ...
```

## Settings

You can change the prefix for your resources using

```yml
custom:
  resourceNames:
    prefix: "awesome-prefix"
```

Default will prefix using your service name in `serverless.yml`

## SNS Topics

This plugin will simplify referencing SNS topics. To reference a topic trigger for your lambda simply use: `${topic:TopicResourceName}` i.e:

```yml
functions:
  hello:
    handler: handler.hello
    events:
      - sns: ${topic:MyTopic}

resources:
  Resources:
    MyTopic:
      Type: AWS::SNS::Topic
```

The plugin will also inject topic ARN as an environment variable using the same naming convetions suffixed by `_ARN`. For the example above that would be: `MY_TOPIC_ARN`

## Commands

Run `serverless env` to print all environment variables (generated and custom)

Note: all [Intristic Functions](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference.html) are printed as escaped json

Example:

```bash
ENVIRONMENT_VALUE_1=1
ENVIRONMENT_VALUE_2=2
SOME_TOPIC_ARN="{\"Fn::Join\":[\":\",[\"arn\",\"aws\",\"sns\",{\"Ref\":\"AWS::Region\"},{\"Ref\":\"AWS::AccountId\"},\"my-prefix-some-topic-dev\"]]}"
SOME_TOPIC="my-prefix-some-topic-dev"
```


