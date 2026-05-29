import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';

export interface IngressStackProps extends cdk.StackProps {
  readonly vpc: ec2.IVpc;
  readonly certificate: acm.ICertificate;
  readonly hostedZone: route53.IHostedZone;
  readonly cluster: ecs.ICluster;
  readonly daemonSg: ec2.ISecurityGroup;
}

export class IngressStack extends cdk.Stack {
  public readonly alb: elbv2.IApplicationLoadBalancer;
  public readonly caddyAdminEndpoint: string;
  public readonly cloudMapNamespaceId: string;
  public readonly cloudMapServiceId: string;
  public readonly caddySg: ec2.ISecurityGroup;

  constructor(scope: Construct, id: string, props: IngressStackProps) {
    super(scope, id, props);

    this.alb = new elbv2.ApplicationLoadBalancer(this, 'DaemonAlb', {
      vpc: props.vpc,
      internetFacing: true,
    });

    const httpsListener = this.alb.addListener('HttpsListener', {
      port: 443,
      certificates: [props.certificate],
    });

    this.alb.addListener('HttpListener', {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,
      }),
    });

    this.caddySg = new ec2.SecurityGroup(this, 'CaddySecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for Caddy ingress service',
      allowAllOutbound: true,
    });

    this.caddySg.addIngressRule(this.alb.connections.securityGroups[0], ec2.Port.tcp(80), 'Allow ALB to reach Caddy');
    this.caddySg.addIngressRule(ec2.Peer.ipv4('10.20.0.0/16'), ec2.Port.tcp(2019), 'Allow VPC access to Caddy admin API');

    const namespace = new servicediscovery.PrivateDnsNamespace(this, 'DaemonsNamespace', {
      vpc: props.vpc,
      name: 'daemons.local',
    });

    const daemonCloudMapService = new servicediscovery.Service(this, 'DaemonCloudMapService', {
      namespace,
      name: 'daemons',
      dnsRecordType: servicediscovery.DnsRecordType.A,
      dnsTtl: cdk.Duration.seconds(10),
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'CaddyTaskDefinition', {
      cpu: 256,
      memoryLimitMiB: 512,
    });

    taskDefinition.addContainer('CaddyContainer', {
      image: ecs.ContainerImage.fromRegistry('caddy:2-alpine'),
      // TODO: replace with a custom Caddy image that enables admin API on 0.0.0.0:2019.
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'caddy' }),
      portMappings: [{ containerPort: 80 }, { containerPort: 2019 }],
    });

    const caddyService = new ecs.FargateService(this, 'CaddyService', {
      cluster: props.cluster,
      taskDefinition,
      desiredCount: 2,
      assignPublicIp: false,
      securityGroups: [this.caddySg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      cloudMapOptions: {
        cloudMapNamespace: namespace,
        name: 'caddy',
      },
    });

    const caddyTargetGroup = new elbv2.ApplicationTargetGroup(this, 'CaddyTargetGroup', {
      vpc: props.vpc,
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
        healthyHttpCodes: '200-399',
      },
    });

    caddyService.attachToApplicationTargetGroup(caddyTargetGroup);

    httpsListener.addTargetGroups('CaddyForward', {
      targetGroups: [caddyTargetGroup],
    });

    new ec2.CfnSecurityGroupIngress(this, 'DaemonFromCaddy', {
      groupId: props.daemonSg.securityGroupId,
      sourceSecurityGroupId: this.caddySg.securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 80,
      toPort: 80,
      description: 'Caddy -> daemon containers',
    });

    new route53.ARecord(this, 'DaemonsWildcardAlias', {
      zone: props.hostedZone,
      recordName: '*.daemons.controlai.io',
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(this.alb)),
    });

    this.caddyAdminEndpoint = 'http://caddy.daemons.local:2019';
    this.cloudMapNamespaceId = namespace.namespaceId;
    this.cloudMapServiceId = daemonCloudMapService.serviceId;
  }
}
