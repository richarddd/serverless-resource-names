"use strict";

const TOPIC_PREFIX = "topic";

const TYPE_TO_PROPERTY_NAME = {
  "AWS::SQS::Queue": "QueueName",
  "AWS::S3::Bucket": "BucketName",
  "AWS::SNS::Topic": "TopicName",
  "AWS::DocDB::DBCluster": "DBClusterIdentifier",
  "AWS::DynamoDB::Table": "TableName",
  "AWS::DocDB::DBInstance": "DBInstanceIdentifier",
  "AWS::EC2::Instance": (name, properties) => {
    const existingTags = properties.Tags || [];
    for (const tag of existingTags) {
      if (tag.Key === "Name") {
        return;
      }
    }
    properties.Tags = [{ Key: "Name", Value: name }, ...existingTags];
  }
};

const _generatedUids = {};
const uuid = () => {
  while (true) {
    var uid = (
      "00000" + ((Math.random() * Math.pow(36, 4)) | 0).toString(36)
    ).slice(-4);
    if (!_generatedUids.hasOwnProperty(uid)) {
      _generatedUids[uid] = true;
      return uid;
    }
  }
};

const convertCase = (text, separator = "_") => {
  const isCapital = char => char.charCodeAt() >= 65 && char.charCodeAt() <= 90;
  return text
    .replace(/[\w]([A-Z])/g, m => {
      if (isCapital(m[0]) && isCapital(m[1])) {
        return `${m[0]}${m[1]}${separator}`;
      }
      return `${m[0]}${separator}${m[1]}`;
    })
    .toLowerCase();
};

class ResourceNamePlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.variables = serverless.variables;
    this.service = serverless.service;
    this.resources = this.service.resources;
    this.options = options;

    const delegate = this.variables.getValueFromSource.bind(this.variables);

    this.variables.getValueFromSource = variableString => {
      if (variableString.startsWith(`${TOPIC_PREFIX}:`)) {
        const variable = variableString.split(`${TOPIC_PREFIX}:`)[1];
        const [topic, value] = variable.split(".");
        return (!value && this.topics[topic]) || this.topics[topic][value];
      }

      return delegate(variableString);
    };

    this.provider = serverless.getProvider("aws");

    this.topics = {};
    this.environmentVariables = {};
    this.typeNames = {};
    this.writeNames();

    this.injected = false;

    this.commands = {
      env: {
        usage: "Prints all environment variables",
        lifecycleEvents: ["environment"]
      }
    };

    this.hooks = {
      "env:environment": this.printEnvironment.bind(this),
      "before:offline:start:init": this.injectVariables.bind(this),
      "before:aws:common:validate:validate": this.injectVariables.bind(this)
    };
  }

  printEnvironment() {
    Object.entries(this.service.provider.environment).forEach(
      ([key, value]) => {
        let printValue = `"${value}"`;
        if (typeof value === "number" || typeof value === "boolean") {
          printValue = value;
        } else if (typeof value === "object") {
          printValue = JSON.stringify(JSON.stringify(value)); //`"object-ref-${uuid()}"`;
        }
        this.serverless.cli.consoleLog(`${key}=${printValue}`);
      }
    );
  }

  injectVariables() {
    if (!this.injected) {
      this.injected = true;
      this.serverless.cli.log(`Applying resource names...`);
      Object.entries(this.environmentVariables).forEach(([key]) => {
        this.serverless.cli.log(`    ✔ Exposing env ${key}`);
      });
    }
  }

  setResourceName(acc, name, type, resource) {
    const { prefix } = (this.service.custom &&
      this.service.custom.resourceNames) || {
      prefix: this.service.service
    };
    const stage = this.service.provider.stage;

    const envName = convertCase(name).toUpperCase();

    const resoureceName = `${prefix}-${envName.replace(
      /_/g,
      "-"
    )}-${stage}`.toLowerCase();

    const nameConverter = TYPE_TO_PROPERTY_NAME[type];
    if (!nameConverter) {
      throw Error(`Missing nameconverter for ${type}`);
    }
    if (nameConverter instanceof Function) {
      nameConverter(resoureceName, resource.Properties || {});
    } else {
      if (!resource.Properties) {
        resource.Properties = {};
      }
      resource.Properties[nameConverter] = resoureceName;
    }
    if (type === "AWS::SNS::Topic") {
      const arnEnvName = `${envName}_ARN`;
      const arnValue = {
        "Fn::Join": [
          ":",
          [
            "arn",
            "aws",
            "sns",
            { Ref: "AWS::Region" },
            { Ref: "AWS::AccountId" },
            resoureceName
          ]
        ]
      };
      acc[arnEnvName] = arnValue;
      this.topics[name] = {
        topicName: resoureceName,
        arn: arnValue
      };
    }

    acc[envName] = resoureceName;
  }

  writeNames() {
    this.environmentVariables = Object.entries(this.resources.Resources).reduce(
      (acc, [key, resource]) => {
        this.setResourceName(acc, key, resource.Type, resource);
        return acc;
      },
      {}
    );
    this.service.provider.environment = {
      ...this.service.provider.environment,
      ...this.environmentVariables
    };
  }
}
module.exports = ResourceNamePlugin;
