const acmeClient = require('acme-client');
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Create the Let's Encrypt account key
const createAccountKey = async () => {
  const accountKeyPath = path.join(__dirname, '..', process.env.LETS_ENCRYPT_ACCOUNT_KEY);
  console.log('Account Key Path:', accountKeyPath);

  let accountKey;

  if (fs.existsSync(accountKeyPath)) {
    // If the account key file already exists, read the key
    accountKey = fs.readFileSync(accountKeyPath, 'utf8');
  } else {
    // If no key exists, generate a new one
    accountKey = acmeClient.forge.createPrivateKey();
    fs.writeFileSync(accountKeyPath, accountKey);
  }
  return accountKey;
};

// Function to create an ACME client
const createAcmeClient = async () => {
  const accountKey = await createAccountKey();
  return new acmeClient.Client({
    directoryUrl: acmeClient.directory.letsencrypt.production,
    accountKey,
  });
};

// Request SSL certificate from Let's Encrypt
const requestCertificate = async (subdomain) => {
  try {
    const client = await createAcmeClient();

    // create account with Let's Encrypt
    const account = await client.createAccount({
         contact: [`mailto:${process.env.LETS_ENCRYPT_EMAIL}`],
         termsOfServiceAgreed: true
    });

    // Create the order for the domain certificate
    const order = await client.createOrder({
      identifiers: [
        { type: 'dns', value: `${subdomain}.${process.env.DOMAIN}` },
      ],
    });

    // Perform DNS-01 challenge
    const authorization = await client.getAuthorizations(order);
    console.log("Authorization",authorization);
    const challenge = authorization[0].challenges.find((chal) => chal.type === 'dns-01');
    console.log("Challenge found:", challenge);
    if (!challenge) {
      throw new Error('No DNS challenge found');
    }

    await createDNSRecord(challenge);

    // Poll for DNS validation success
    let result;
    let attempts = 0;
    while (attempts <2) {  // Poll for a max of 30 attempts
      attempts++;
      console.log(`Polling attempt ${attempts}...`);
      // Get the authorization status
      result = await client.getAuthorizations(challenge.url);
      if (result.status === 'valid') {
        console.log('DNS validation successful');
        break;
      }

      console.log('DNS validation in progress...');
      // Wait for 10 seconds before retrying
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }

    if (result.status !== 'valid') {
      throw new Error('DNS validation failed');
    }

    // Finalize the certificate order
    const certificate = await client.finalizeOrder(order, challenge);
    return certificate;
  } catch (error) {
    console.error('Error in certificate request:', error);
    throw error;
  }
};

// Create DNS TXT record for validation
const createDNSRecord = async (challenge) => {
  const { token, value } = challenge;

  try {
    const dnsData = {
      type: 'TXT',
      name: `_acme-challenge.${token}`,
      value: `"${value}"`,
      ttl: 600,
    };

    console.log("====dns-data========",dnsData);

    // Using AWS Route 53 as an example
   if (process.env.DNS_PROVIDER === 'Route53') {
      // AWS Route 53 DNS record creation
      const route53 = new AWS.Route53();
      const params = {
        HostedZoneId: process.env.ROUTE53_HOSTED_ZONE_ID,
        ChangeBatch: {
          Changes: [
            {
              Action: 'UPSERT',
              ResourceRecordSet: dnsData,
            },
          ],
        },
      };
      await route53.changeResourceRecordSets(params).promise();
      console.log(`Route53 DNS record created for challenge: ${token}`);
    }
  } catch (error) {
    console.error('Error in creating DNS record:', error);
    throw error;
  }
};

// Poll for certificate status
const waitForCertificate = async (certificateArn, timeout = 60000) => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const certificateStatus = await getCertificateStatus(certificateArn);
    if (certificateStatus === 'ISSUED') {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000)); // Poll every 5 seconds
  }
  return false;
};

// Simulate certificate status retrieval (for now)
const getCertificateStatus = async (certificateArn) => {
  return 'ISSUED'; // Replace with actual status retrieval
};

// Create CloudFront Distribution
const createCloudFrontDistribution = async (subdomain, certificateArn, mappedTo) => {
  const cloudfront = new AWS.CloudFront();

  const params = {
    DistributionConfig: {
      CallerReference: `getirnow-${subdomain}-${Date.now()}`,
      Aliases: {
        Quantity: 1,
        Items: [`${subdomain}.${process.env.DOMAIN}`],
      },
      DefaultCacheBehavior: {
        TargetOriginId: 'S3-getirnow',
        ViewerProtocolPolicy: 'redirect-to-https',
        AllowedMethods: {
          Quantity: 2,
          Items: ['GET', 'HEAD'],
          CachedMethods: {
            Quantity: 2,
            Items: ['GET', 'HEAD'],
          },
        },
      },
      Origins: {
        Quantity: 1,
        Items: [
          {
            Id: 'S3-getirnow',
            DomainName: mappedTo, // Your internal route or AWS resource
            CustomOriginConfig: {
              HTTPPort: 80,
              HTTPSPort: 443,
              OriginProtocolPolicy: 'https-only',
            },
          },
        ],
      },
      DefaultRootObject: 'index.html',
      Enabled: true,
      ViewerCertificate: {
        ACMCertificateArn: certificateArn,
        SslSupportMethod: 'sni-only',
      },
    },
  };

  try {
    const distribution = await cloudfront.createDistribution(params).promise();
    console.log('CloudFront Distribution created:', distribution);
    return distribution.DomainName;
  } catch (error) {
    console.error('Error in creating CloudFront distribution:', error);
    throw error;
  }
};

// Export utility functions
module.exports = {
  requestCertificate,
  createDNSRecord,
  waitForCertificate,
  getCertificateStatus,
  createCloudFrontDistribution,
};
