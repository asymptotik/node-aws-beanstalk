
var fs = require('fs');
var AWS = require('aws-sdk');
var Q = require('Q');

console.log('####################################################################')
var logger;
var params = { hello:'world' };
var conf;

var pick = function(src, keys) {
	var ret = {};
	keys.forEach(function(key) {
		ret[key] = src[key];
		if (ret[key] === undefined) {
			delete ret[key];
		}
	});
	return ret;
};

var S3 = null;
var getS3 = function() {
	if (!S3) {
		S3 = new AWS.S3({
			region: conf.region,
			accessKeyId: 'accessKeyId' in conf ? conf.accessKeyId : '',
			secretAccessKey: 'secretAccessKey' in conf ? conf.secretAccessKey : ''
		});
	}

	return S3;
};

var beanstalk = null;
var getBeanstalk = function() {
	if (!beanstalk) {
		beanstalk = new AWS.ElasticBeanstalk({
			region: conf.region,
			accessKeyId: 'accessKeyId' in conf ? conf.accessKeyId : '',
			secretAccessKey: 'secretAccessKey' in conf ? conf.secretAccessKey : ''
		});
	}

	return beanstalk;
};

var createEnvironment = function() {

	return Q.Promise(function(resolve, reject, notify) {
		if (!params.SolutionStackName && !params.TemplateName) {
			reject(new Error('Missing either "solutionStack" or "template" config'));
		}
		if (params.SolutionStackName && params.TemplateName) {
			reject(new Error('Provided both "solutionStack" and "template" config; only one or the other supported'));
		}

		logger('Creating environment "' + params.EnvironmentName + '"...');
		getBeanstalk().createEnvironment(
			pick(params, ['ApplicationName', 'EnvironmentName', 'Description', 'OptionSettings', 'SolutionStackName', 'TemplateName', 'VersionLabel', 'Tier', 'Tags']),
			function(err, data) {
				if (err) {
					logger('Create environment failed. Check your iam:PassRole permissions.');
					reject(new Error(err));
				} else {
					logger('Environment "' + params.EnvironmentName + '" created and is now being launched.');
					resolve(data);
				}
			}
		);
	});
};

var updateEnvironment = function() {

	return Q.Promise(function(resolve, reject, notify) {
		if (!params.SolutionStackName && !params.TemplateName) {
			reject(new Error('Missing either "solutionStack" or "template" config'));
		}
		if (params.SolutionStackName && params.TemplateName) {
			reject(new Error('Provided both "solutionStack" and "template" config; only one or the other supported'));
		}

		logger('Updating environment "' + params.EnvironmentName + '"...');
		getBeanstalk().updateEnvironment(
			pick(params, ['EnvironmentName', 'Description', 'OptionSettings', 'SolutionStackName', 'TemplateName', 'VersionLabel']),
			function(err, data) {
				if (err) {
					logger('Create environment failed. Check your iam:PassRole permissions.');
					reject(new Error(err));
				} else {
					logger('Environment "' + params.EnvironmentName + '" updated and is now being launched.');
					resolve(data);
				}
			}
		);
	});
};

var describeEnvironments = function() {

	return Q.Promise(function(resolve, reject, notify) {
		logger('Checking for environment "' + params.EnvironmentName + '"...');
		getBeanstalk().describeEnvironments({
				ApplicationName: params.ApplicationName,
				EnvironmentNames: [params.EnvironmentName]
			},
			function(err, data) {
				if (err) {
					logger('beanstalk.describeApplication request failed. Check your AWS credentials and permissions.');
					reject(new Error(err));
				} else {
					resolve(data);
				}
			}
		);
	});
}

var createOrUpdateEnvironment = function() {
	return describeEnvironments().then(function(data) {
		if (data.Environments && data.Environments.length > 0) {
			if (data.Environments[0].Status !== 'Ready') {
				logger('Environment is currently not in "Ready" status (currently "' + data.Environments[0].Status + '"). Please resolve/wait and try again.');
				throw new Error('Environment is currently not in "Ready" status (currently "' + data.Environments[0].Status + '"). Please resolve/wait and try again.');
			} else {
				return updateEnvironment();
			}
		} else {
			return createEnvironment();
		}
	});
};

var createApplicationVersion = function() {

	return Q.Promise(function(resolve, reject, notify) {
		logger('Creating application "' + params.ApplicationName + '" version "' + params.VersionLabel + '"...');
		getBeanstalk().createApplicationVersion(
			pick(params, ['ApplicationName', 'Description', 'AutoCreateApplication', 'VersionLabel', 'SourceBundle']),
			function(err, data) {
				if (err) {
					logger('Create application version failed. Check your iam:PassRole permissions.');
					reject(new Error(err));
				} else {
					resolve(data);
				}
			});
	});
};

var describeApplicationVersions = function() {

	return Q.Promise(function(resolve, reject, notify) {
		logger('Checking for application "' + params.ApplicationName + '" version "' + params.VersionLabel + '"...');
		getBeanstalk().describeApplicationVersions({
				ApplicationName: params.ApplicationName,
				VersionLabels: [params.VersionLabel]
			},
			function(err, data) {
				if (err) {
					logger('beanstalk.describeApplication request failed. Check your AWS credentials and permissions.');
					reject(new Error(err));
				} else {
					resolve(data);
				}
			}
		);
	});
};

var optionallyCreateApplication = function() {

	return describeApplicationVersions().then(function(data) {
		if (!data.ApplicationVersions || data.ApplicationVersions.length === 0) {
			return createApplicationVersion();
		}
	});
};

var uploadCode = function() {
	return Q.Promise(function(resolve, reject, notify) {
		logger('Uploading code to S3 bucket "' + params.SourceBundle.S3Bucket + '"...');
		fs.readFile(conf.codePackage, function(err, data) {
			if (err) {
				reject(new Error('Error reading specified package "' + conf.codePackage + '"'));
				return;
			}
			getS3().upload({
					Bucket: params.SourceBundle.S3Bucket,
					Key: params.SourceBundle.S3Key,
					Body: data,
					ContentType: 'binary/octet-stream'
				},
				function(err, data) {
					if (err) {
						logger('Upload of "' + conf.codePackage + '" to S3 bucket failed.');
						reject(new Error(err));
					} else {
						resolve(data);
					}
				}
			);
		});
	});
};

var createBucket = function() {
	return Q.Promise(function(resolve, reject, notify) {
		logger('Creating S3 bucket "' + params.SourceBundle.S3Bucket + '"...');
		getS3().createBucket({
				Bucket: params.SourceBundle.S3Bucket
			},
			function(err, data) {
				if (err) {
					logger('Create S3 bucket "' + params.Bucket + '" failed.');
					reject(new Error(err));
				} else {
					resolve(data);
				}
			}
		);
	});
};

var headBucket = function() {
	logger('params:' + JSON.stringify(params));

	return Q.Promise(function(resolve, reject, notify) {
		logger('Checking for S3 bucket "' + params.SourceBundle.S3Bucket + '"...');
		getS3().headBucket({
				Bucket: params.SourceBundle.S3Bucket
			},
			function(err, data) {
				if (err) {
					if (err.statusCode === 404) {
						logger('S3 bucket "' + params.SourceBundle.S3Bucket + '" does not exits.');
						resolve();
					} else {
						logger('S3.headBucket request failed. Check your AWS credentials and permissions.');
						reject(new Error(err));
					}
				} else {
					logger('S3 bucket "' + params.SourceBundle.S3Bucket + '" exits.');
					resolve(data);
				}
			}
		);
	});
};

var checkBucket = function() {

	return headBucket().then(function(data) {
		if (!data) {
			return createBucket();
		}
	});
};

var init = function(config) {
	if (!config.logger) {
		config.logger = console.log;
	}

	if ("profile" in config) {
		var credentials = new AWS.SharedIniFileCredentials({
			profile: config.profile
		});
		AWS.config.credentials = credentials;
	}

	if (process.env.HTTPS_PROXY) {
		if (!AWS.config.httpOptions) {
			AWS.config.httpOptions = {};
		}
		var HttpsProxyAgent = require('https-proxy-agent');
		AWS.config.httpOptions.agent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
	}

	config.version = config.version !== undefined ? config.version : '1.0.0';
	var packageName = config.codePackage.split('/');

	params = {
		ApplicationName: config.appName,
		EnvironmentName: config.envName,
		Description: config.description,
		VersionLabel: config.version,
		SourceBundle: {
			S3Bucket: (config.S3Bucket ? config.S3Bucket : config.appName).toLowerCase(),
			S3Key: config.version + '-' + packageName[packageName.length - 1]
		},
		AutoCreateApplication: true,
		SolutionStackName: config.solutionStack,
		TemplateName: config.template,
		Tier: {
			Name: config.tier || 'WebServer',
			Type: config.tier === 'Worker' ? 'SQS/HTTP' : 'Standard',
			Version: '1.0'
		},
		Tags: config.environmentTags,
		OptionSettings: config.environmentSettings
	};
	conf = config;

	logger = config.logger;
	logger('params:' + JSON.stringify(params));
};

exports.init = function(config) {
	init(config);
	return exports;
};

exports.deploy = function(callback) {
	logger('params:' + JSON.stringify(params));

	return checkBucket().then(uploadCode).then(optionallyCreateApplication).then(createOrUpdateEnvironment).then(callback, function(err) { logger(err); logger(err.stack); });
};