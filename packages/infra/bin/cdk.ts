#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { DnsStack } from '../lib/dns-stack';
import { EcsStack } from '../lib/ecs-stack';
import { IngressStack } from '../lib/ingress-stack';
import { MonitoringStack } from '../lib/monitoring-stack';
import { NetworkStack } from '../lib/network-stack';

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'ap-northeast-2',
};

const networkStack = new NetworkStack(app, 'controlai-network', { env });

const ecsStack = new EcsStack(app, 'controlai-ecs', {
  env,
  vpc: networkStack.vpc,
});

const dnsStack = new DnsStack(app, 'controlai-dns', { env });

const ingressStack = new IngressStack(app, 'controlai-ingress', {
  env,
  vpc: networkStack.vpc,
  certificate: dnsStack.cert,
  hostedZone: dnsStack.hostedZone,
  cluster: ecsStack.cluster,
  daemonSg: ecsStack.daemonSg,
});

new MonitoringStack(app, 'controlai-monitoring', {
  env,
  cluster: ecsStack.cluster,
  alb: ingressStack.alb,
});

new ssm.StringParameter(ingressStack, 'EcsClusterNameParam', {
  parameterName: '/controlai/infra/ECS_CLUSTER_NAME',
  stringValue: ecsStack.cluster.clusterName,
});

new ssm.StringParameter(ingressStack, 'EcsTaskRoleArnParam', {
  parameterName: '/controlai/infra/ECS_TASK_ROLE_ARN',
  stringValue: ecsStack.taskRole.roleArn,
});

new ssm.StringParameter(ingressStack, 'EcsExecutionRoleArnParam', {
  parameterName: '/controlai/infra/ECS_EXECUTION_ROLE_ARN',
  stringValue: ecsStack.executionRole.roleArn,
});

new ssm.StringParameter(ingressStack, 'EcsSecurityGroupIdParam', {
  parameterName: '/controlai/infra/ECS_SECURITY_GROUP_ID',
  stringValue: ecsStack.daemonSg.securityGroupId,
});

new ssm.StringParameter(ingressStack, 'EcsSubnetsParam', {
  parameterName: '/controlai/infra/ECS_SUBNETS',
  stringValue: cdk.Fn.join(
    ',',
    networkStack.vpc.privateSubnets.map((subnet) => subnet.subnetId),
  ),
});

new ssm.StringParameter(ingressStack, 'CaddyAdminEndpointParam', {
  parameterName: '/controlai/infra/CADDY_ADMIN_ENDPOINT',
  stringValue: ingressStack.caddyAdminEndpoint,
});

new ssm.StringParameter(ingressStack, 'SecretsKmsKeyArnParam', {
  parameterName: '/controlai/infra/SECRETS_KMS_KEY_ARN',
  stringValue: ecsStack.kmsKey.keyArn,
});

new ssm.StringParameter(ingressStack, 'DaemonLogGroupParam', {
  parameterName: '/controlai/infra/DAEMON_LOG_GROUP',
  stringValue: ecsStack.logGroup.logGroupName,
});

new ssm.StringParameter(ingressStack, 'CloudMapNamespaceIdParam', {
  parameterName: '/controlai/infra/CLOUD_MAP_NAMESPACE_ID',
  stringValue: ingressStack.cloudMapNamespaceId,
});

new ssm.StringParameter(ingressStack, 'CloudMapServiceIdParam', {
  parameterName: '/controlai/infra/CLOUD_MAP_SERVICE_ID',
  stringValue: ingressStack.cloudMapServiceId,
});

app.synth();
