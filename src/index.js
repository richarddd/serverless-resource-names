"use strict";

const TOPIC_PREFIX = "topic";

const TYPE_TO_PROPERTY_NAME = {
  "AWS::SQS::Queue": "QueueName",
  "AWS::S3::Bucket": "BucketName",
  "AWS::SNS::Topic": "TopicName",
  "AWS::Lambda::Function": "FunctionName",
  "AWS::DocDB::DBCluster": "DBClusterIdentifier",
  "AWS::DynamoDB::Table": "TableName",
  "AWS::DocDB::DBInstance": "DBInstanceIdentifier",
  "AWS::EC2::Instance": (name, properties) => {
    const existingTags = properties.Tags || [];
    for (const tag of existingTags) {
      if (tag.Key === "Name") {
        return tag.value;
      }
    }
    properties.Tags = [{ Key: "Name", Value: name }, ...existingTags];
    return name;
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
    this.provider = serverless.getProvider("aws");
    this.topics = {};
    this.environmentVariables = {};
    this.injected = false;

    this.variableResolvers = {
      topic: {
        resolver: this.getTopicValue.bind(this),
        serviceName: "Serverless resource names",
        isDisabledAtPrepopulation: true
      }
    };

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

  async getTopicValue(src) {
    const variable = src.split(`${TOPIC_PREFIX}:`)[1];
    const [topic, property] = variable.split(".");

    await this.injectVariables();

    const value =
      (!property && this.topics[topic]) ||
      (this.topics[topic] && this.topics[topic][property]);
    if (!this.topics[topic]) {
      throw new this.serverless.classes.Error(
        `Can not find topic with resouce name: ${topic}`
      );
    }

    if (!value) {
      throw new this.serverless.classes.Error(
        `Can not find property "${property}" in topic: ${topic}`
      );
    }

    return value;
  }

  async printEnvironment() {
    await this.writeNames();

    Object.entries(this.service.provider.environment).forEach(
      ([key, value]) => {
        let printValue = `"${value}"`;
        if (typeof value === "number" || typeof value === "boolean") {
          printValue = value;
        } else if (typeof value === "object") {
          printValue = JSON.stringify(JSON.stringify(value));
        }
        this.serverless.cli.consoleLog(`${key}=${printValue}`);
      }
    );
  }

  async injectVariables() {
    await this.writeNames();
    if (!this.injected) {
      this.injected = true;
      this.serverless.cli.log(`Applying resource names...`);
      Object.entries(this.environmentVariables).forEach(([key]) => {
        this.serverless.cli.log(`    ✔ Exposing env ${key}`);
      });
    }
  }

  setResourceName(acc, name, type, resource, stage) {
    const { prefix } = (this.service.custom &&
      this.service.custom.resourceNames) || {
      prefix: this.service.service
    };

    const envName = convertCase(name).toUpperCase();

    let resoureceName = `${prefix}-${envName.replace(
      /_/g,
      "-"
    )}-${stage}`.toLowerCase();

    const nameConverter = TYPE_TO_PROPERTY_NAME[type];
    if (!nameConverter) {
      return;
    }
    if (nameConverter instanceof Function) {
      resoureceName = nameConverter(resoureceName, resource.Properties || {});
    } else {
      if (!resource.Properties) {
        resource.Properties = {};
      }
      if (resource.Properties[nameConverter]) {
        resoureceName = resource.Properties[nameConverter];
      } else {
        resource.Properties[nameConverter] = resoureceName;
      }
    }

    const addArn = value => {
      acc[`${envName}_ARN`] = value;
    };

    if (type === "AWS::SQS::Queue") {
      addArn({
        "Fn::GetAtt": [name, "Arn"]
      });
    } else if (type === "AWS::SNS::Topic") {
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
      addArn(arnValue);
      this.topics[name] = {
        topicName: resoureceName,
        arn: arnValue
      };
    }
    acc[envName] = resoureceName;
  }

  async writeNames() {
    if (!this.injected && this.resources) {
      const resources = await this.serverless.variables.populateValue(
        this.resources,
        true
      );
      this.environmentVariables = Object.entries(resources.Resources).reduce(
        (acc, [key, resource]) => {
          this.setResourceName(
            acc,
            key,
            resource.Type,
            resource,
            this.service.provider.stage
          );
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
}
module.exports = ResourceNamePlugin;
