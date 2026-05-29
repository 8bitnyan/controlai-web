import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';

export class DnsStack extends cdk.Stack {
  public readonly hostedZone: route53.IHostedZone;
  public readonly cert: acm.ICertificate;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    this.hostedZone = new route53.HostedZone(this, 'DaemonsHostedZone', {
      zoneName: 'daemons.controlai.io',
    });

    this.cert = new acm.Certificate(this, 'DaemonsWildcardCertificate', {
      domainName: '*.daemons.controlai.io',
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
    });
  }
}
