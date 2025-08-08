const acmeClient = require('acme-client');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// create the Let's Encrypt account key
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
    accountKey
  });
};

// Function to request a certificate from Let's Encrypt
const requestCertificate = async (subdomain) => {
  try {
    const client = await createAcmeClient();

    // Creating account with Let's Encrypt
    const account = await client.createAccount({
      contact: [`mailto:${process.env.LETS_ENCRYPT_EMAIL}`],
      termsOfServiceAgreed: true
    });

    // Log the account to see what is returned
    console.log('Account created:', account);

    // Create the order for the domain certificate
    const order = await client.createOrder({
      identifiers: [
        { type: 'dns', value: `${subdomain}.${process.env.DOMAIN}` }  // error zone found   working with debsom.com but not with debsom.shop
      ]
    });

    // Perform DNS-01 challenge
    const authorization = await client.getAuthorizations(order);
    const challenge = authorization[0].challenges.find(chal => chal.type === 'dns-01');
    console.log("=============challenge==========", challenge);
    // const challenge = authorization.find(chal => chal.type === 'dns-01');

    if (!challenge) {
      throw new Error('No DNS challenge found');
    }

    await createDNSRecord(challenge);

    // Poll for DNS validation success
    const result = await client.pollAuthorization(authorization);
    if (result.status === 'valid') {
      // Finalize the certificate order
      const certificate = await client.finalizeOrder(order, challenge);
      return certificate;
    }

    throw new Error('DNS validation failed');
  } catch (error) {
    console.error('Error in certificate request:', error);
    throw error;
  }
};

// Function to create DNS TXT record in GoDaddy for validation
const createDNSRecord = async (challenge) => {
  const { token } = challenge; // Use the challenge token directly

  try {
    // The DNS record name is usually _acme-challenge.<token>
    const dnsData = {
      type: 'TXT',
      name: `_acme-challenge.${token}`,
      data: challenge.value, // This is the value you need to place in the TXT record
      ttl: 600
    };

    // GoDaddy API call to create the TXT record
    await axios.post(`https://api.godaddy.com/v1/domains/${process.env.DOMAIN}/records/TXT`, [dnsData], {
      headers: {
        Authorization: `sso-key ${process.env.GODADDY_API_KEY}:${process.env.GODADDY_API_SECRET}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`DNS record created for challenge: ${token}`);
  } catch (error) {
    console.error('Error in creating DNS record:', error);
    throw error;
  }
};

// Function to check certificate status (simulating the polling)
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

// Function to simulate certificate status retrieval (you can customize this if using actual AWS)
const getCertificateStatus = async (certificateArn) => {
  return 'ISSUED'; // Simulating certificate issuance status for now until aws-sdk used
};

// Export all the utility functions
module.exports = {
  requestCertificate,
  createDNSRecord,
  waitForCertificate,
  getCertificateStatus
};
