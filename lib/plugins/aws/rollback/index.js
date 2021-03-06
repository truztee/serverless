'use strict';

const _ = require('lodash');
const BbPromise = require('bluebird');
const validate = require('../lib/validate');
const setBucketName = require('../lib/setBucketName');
const updateStack = require('../lib/updateStack');
const monitorStack = require('../lib/monitorStack');
const findAndGroupDeployments = require('../utils/findAndGroupDeployments');

class AwsRollback {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider('aws');

    Object.assign(
      this,
      validate,
      setBucketName,
      updateStack,
      monitorStack
    );

    this.hooks = {
      'before:rollback:initialize': () => BbPromise.bind(this)
        .then(this.validate),
      'rollback:rollback': () => BbPromise.bind(this)
        .then(this.setBucketName)
        .then(this.setStackToUpdate)
        .then(this.updateStack),
    };
  }

  setStackToUpdate() {
    const service = this.serverless.service;
    const serviceName = this.serverless.service.service;
    const stage = this.options.stage;
    const prefix = `serverless/${serviceName}/${stage}`;

    return this.provider.request('S3',
      'listObjectsV2',
      {
        Bucket: this.bucketName,
        Prefix: prefix,
      },
      this.options.stage,
      this.options.region)
      .then((response) => {
        const deployments = findAndGroupDeployments(response, serviceName, stage);

        if (deployments.length === 0) {
          const msg = 'Couldn\'t find any existing deployments.';
          const hint = 'Please verify that stage and region are correct.';
          return BbPromise.reject(`${msg} ${hint}`);
        }

        const date = new Date(this.options.timestamp);
        const dateString = `${date.getTime().toString()}-${date.toISOString()}`;
        const exists = _.some(deployments, (deployment) => (
          _.some(deployment, {
            directory: dateString,
            file: 'cloudformation-template-update-stack.json',
          })
        ));

        if (!exists) {
          const msg = `Couldn't find a deployment for the timestamp: ${this.options.timestamp}.`;
          const hint = 'Please verify that the timestamp, stage and region are correct.';
          return BbPromise.reject(`${msg} ${hint}`);
        }

        service.package.artifactDirectoryName = `${prefix}/${dateString}`;
        return BbPromise.resolve();
      });
  }
}

module.exports = AwsRollback;
