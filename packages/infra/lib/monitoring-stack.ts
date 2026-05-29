import * as cdk from 'aws-cdk-lib';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

export interface MonitoringStackProps extends cdk.StackProps {
  readonly cluster: ecs.ICluster;
  readonly alb: elbv2.IApplicationLoadBalancer;
}

export class MonitoringStack extends cdk.Stack {
  public readonly topic: sns.ITopic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const topic = new sns.Topic(this, 'DaemonAlertsTopic', {
      topicName: 'controlai-daemons-alerts',
    });
    this.topic = topic;

    const cpuAlarm = new cw.Alarm(this, 'ClusterHighCpuAlarm', {
      metric: new cw.Metric({
        namespace: 'AWS/ECS',
        metricName: 'CPUUtilization',
        dimensionsMap: { ClusterName: props.cluster.clusterName },
        period: cdk.Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    cpuAlarm.addAlarmAction(new cw_actions.SnsAction(topic));

    const memoryAlarm = new cw.Alarm(this, 'ClusterHighMemoryAlarm', {
      metric: new cw.Metric({
        namespace: 'AWS/ECS',
        metricName: 'MemoryUtilization',
        dimensionsMap: { ClusterName: props.cluster.clusterName },
        period: cdk.Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    memoryAlarm.addAlarmAction(new cw_actions.SnsAction(topic));

    const alb5xxAlarm = new cw.Alarm(this, 'Alb5xxAlarm', {
      metric: props.alb.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, {
        period: cdk.Duration.minutes(1),
      }),
      threshold: 10,
      evaluationPeriods: 5,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    alb5xxAlarm.addAlarmAction(new cw_actions.SnsAction(topic));

    new events.Rule(this, 'EcsDeploymentFailedRule', {
      eventPattern: {
        source: ['aws.ecs'],
        detailType: ['ECS Deployment State Change'],
        resources: [props.cluster.clusterArn],
        detail: {
          eventName: ['SERVICE_DEPLOYMENT_FAILED'],
          deploymentState: ['FAILED'],
        },
      },
      targets: [new targets.SnsTopic(topic)],
    });
  }
}
