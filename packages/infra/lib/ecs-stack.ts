import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface EcsStackProps extends cdk.StackProps {
  readonly vpc: ec2.IVpc;
}

export class EcsStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly taskRole: iam.Role;
  public readonly executionRole: iam.Role;
  public readonly daemonSg: ec2.SecurityGroup;
  public readonly kmsKey: kms.Key;
  public readonly logGroup: logs.LogGroup;
  public readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    this.cluster = new ecs.Cluster(this, 'DaemonCluster', {
      vpc: props.vpc,
      clusterName: 'controlai-daemons',
    });

    const asg = new autoscaling.AutoScalingGroup(this, 'DaemonAsg', {
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MEDIUM),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      minCapacity: 1,
      maxCapacity: 10,
    });

    const capacityProvider = new ecs.AsgCapacityProvider(this, 'DaemonAsgCapacityProvider', {
      autoScalingGroup: asg,
    });
    this.cluster.addAsgCapacityProvider(capacityProvider);

    this.taskRole = new iam.Role(this, 'DaemonTaskRole', {
      roleName: 'controlai-daemon-task-role',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    this.kmsKey = new kms.Key(this, 'DaemonSecretsKey', {
      alias: 'alias/controlai/daemon-secrets',
      enableKeyRotation: true,
    });

    this.executionRole = new iam.Role(this, 'DaemonExecutionRole', {
      roleName: 'controlai-daemon-execution-role',
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    this.executionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
    );

    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: ['arn:aws:secretsmanager:*:*:secret:controlai/daemon/*'],
      }),
    );

    this.executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: [this.kmsKey.keyArn],
      }),
    );

    this.repository = new ecr.Repository(this, 'DaemonRepository', {
      repositoryName: 'controlai-daemon',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ maxImageCount: 10, rulePriority: 1 }],
    });

    this.logGroup = new logs.LogGroup(this, 'DaemonLogGroup', {
      logGroupName: '/aws/ecs/controlai-daemons',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.daemonSg = new ec2.SecurityGroup(this, 'DaemonSecurityGroup', {
      vpc: props.vpc,
      securityGroupName: 'controlai-daemon-tasks',
      description: 'Security group for daemon ECS tasks',
      allowAllOutbound: false,
    });

    this.daemonSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS outbound');
    this.daemonSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(1883), 'Allow MQTT outbound');
    this.daemonSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8883), 'Allow MQTT over TLS outbound');
  }
}
