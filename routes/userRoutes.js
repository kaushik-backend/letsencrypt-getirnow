const express = require('express');
const bcrypt = require('bcryptjs');
const CryptoJS = require("crypto-js");
const jwt = require('jsonwebtoken');
const User = require('../models/User'); 
const CustomerDomain = require("../models/customerDomain");
const { requestCertificate, waitForCertificate, createDNSRecord, getCertificateStatus } = require('../utils/customer-setup');
const router = express.Router();

const dotenv = require("dotenv");
dotenv.config();


const { DNSProvider } = require('../utils/DNSProvider');  // DNS provider helper (e.g., GoDaddy, Route53, etc.)

const createCustomerDomainAfterRegistration = async (user) => {
   console.log("=============inside-createCustomerDomainAfterRegistration========");
  try {
     console.log("=============before subdomain========");
    const subdomain = `investor.${user.domain}`;  // Subdomain for the user
     console.log("=============after subdomain========",subdomain);
    // Check if the subdomain and domain combination already exists
    const existingDomain = await CustomerDomain.findOne({ subdomain, companyName: user.companyname });
    if (existingDomain) {
      console.log(`Subdomain ${subdomain} already exists for the company ${user.companyname}.`);
      return;
    }

     const stockSymbol = user.stock_ticker_symbol.toLowerCase();
    const mappedTo = `${stockSymbol}.debsom.shop`;  // Mapping destination for the subdomain

    // Create a new customer domain record with a 'pending' status
    const customerDomain = new CustomerDomain({
      companyName: user.companyname,
      stockSymbol: user.stock_ticker_symbol,
      companyWebsite: `https://${user.domain}`,
      subdomain,
      mappedTo,
      customerDNSProvider: 'GoDaddy', // Specify DNS provider
      user: user._id,
      status: 'pending'
    });

    // Request SSL certificate from Let's Encrypt
    try {
      const certificateArn = await requestCertificate(subdomain); // updated to Let's Encrypt 
      customerDomain.certificateArn = certificateArn;
      customerDomain.status = 'dns_validation';  // Set status to DNS validation

      // Get DNS validation records from Let's Encrypt
      const dnsValidationData = await createDNSRecord(certificateArn);  // DNS record creation logic
      console.log("DNS Validation Record:", dnsValidationData);

      const { name, type, value } = dnsValidationData;
       console.log("=======dns-validation-data=======".dnsValidationData);
      // Set DNS validation data on the customer domain record
      if (dnsValidationData) {
        customerDomain.dnsValidation = {
          name,
          type,
          value
        };
      } else {
        customerDomain.errorMessage = 'DNS validation records not yet available. Please try again later.';
        console.log(`DNS validation records not yet available for ${subdomain}.`);
      }

      // Save customer domain
      await customerDomain.save();
      console.log(`Customer domain created successfully for ${user.companyname} mapped to ${mappedTo}`);

      // If DNS validation data is ready, continue to certificate issuance
      if (dnsValidationData) {
        const AUTO_CREATE_DISTRIBUTION = process.env.AUTO_CREATE_DISTRIBUTION === 'true';
        if (AUTO_CREATE_DISTRIBUTION) {
          console.log(`Attempting to check certificate status for ${subdomain}...`);
          const isIssued = await waitForCertificate(certificateArn, 1); // Poll for certificate issuance
          if (isIssued) {
            console.log(`Certificate issued for ${subdomain}, creating CloudFront distribution...`);
            customerDomain.status = 'certificate_issued';
            await customerDomain.save();

            // Create CloudFront distribution (optional if you're using AWS)
            // const cloudfrontDomain = await createCloudFrontDistribution(subdomain, certificateArn, mappedTo);
            // if (cloudfrontDomain) {
            //   customerDomain.cloudfrontDomain = cloudfrontDomain;
            //   customerDomain.status = 'cloudfront_created';
            //   await customerDomain.save();
            //   console.log(`CloudFront domain name saved for ${subdomain}: ${cloudfrontDomain}`);
            // } else {
            //   console.error(`Failed to create CloudFront distribution for ${subdomain}.`);
            // }
          } else {
            console.log(`Certificate for ${subdomain} not issued yet.`);
          }
        }
      }
    } catch (error) {
      customerDomain.status = 'error';
      customerDomain.errorMessage = `Certificate request failed: ${error.message}`;
      await customerDomain.save();
      console.error('Error in certificate request during customer domain creation:', error);
    }
  } catch (error) {
    console.error('Error creating customer domain after registration:', error);
  }
};

// updated sign-up route
router.post('/sign-up',async (req, res) => {
    console.log("====data=====",req.body)
    const {
      firstname,
      lastname,
      companyname,
      domain,
      email,
      phone,
      stock_ticker_symbol,
      password,
    } = req.body;

  try {
    // // Decrypt the incoming encrypted data
    // const decryptedBytes = CryptoJS.AES.decrypt(data, process.env.DECRYPT_SECRET_KEY);
    // const decryptedText = decryptedBytes.toString(CryptoJS.enc.Utf8);

    // if (!decryptedText) {
    //   return res.status(400).json({
    //     success: false,
    //     message: "Invalid or tampered encrypted data.",
    //   });
    // }

    // const decryptedPayload = JSON.parse(decryptedText);

    // Validate required fields
    if (!(firstname && companyname && domain && email && stock_ticker_symbol)) {
      return res.status(400).json({
        success: false,
        message: "All mandatory fields are required",
      });
    }

    // Check for spaces in domain
    if (domain.trim().includes(" ")) {
      return res.status(400).json({
        success: false,
        message: "White spaces are not allowed in Domain name, please check carefully!",
      });
    }

    // Validate domain format
    const domainRegex = /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}$/;
    if (!domainRegex.test(domain)) {
      return res.status(400).json({
        success: false,
        message: "Invalid domain name (e.g. company.com, mydomain.org)",
      });
    }

    // Check if email, company name, and domain already exist
    const emailExists = await User.findOne({ email });
    const companyExists = await User.findOne({ companyname });
    const domainExist = await User.findOne({ domain });

    if (emailExists) {
      return res.status(409).json({
        success: false,
        message: "This email is already registered, Please login!",
      });
    }
    if (companyExists) {
      return res.status(409).json({
        success: false,
        message: "This Company name is already registered, Choose a different one!",
      });
    }
    if (domainExist) {
      return res.status(409).json({
        success: false,
        message: "This Domain name is already registered!",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create a new user
    const newUser = new User({
      firstname: firstname?.trim(),
      lastname: lastname?.trim() || "",
      companyname: companyname?.trim().toLowerCase(),
      domain: domain?.toLowerCase()?.trim(),
      stock_ticker_symbol: stock_ticker_symbol?.toUpperCase()?.trim(),
      email: email?.trim(),
      phone: phone,
      password: hashedPassword,
    });

    await newUser.save();

    // After registration, create the customer domain
    setTimeout(async () => {
      try {
        await createCustomerDomainAfterRegistration(newUser);
      } catch (err) {
        console.error('Error during customer domain creation:', err);
      }
    }, 0);

    // Generate JWT token for the user
    const payload = {
      id: newUser._id,
      email: newUser.email,
    };
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "24h" });

    return res.status(200).json({
      success: true,
      message: "Welcome to the IR platform ",
      user: {
        firstname: newUser.firstname,
        lastname: newUser.lastname,
        companyname: newUser.companyname,
        domain: newUser.domain,
        stock_ticker_symbol: newUser.stock_ticker_symbol,
        email: newUser.email,
        phone: newUser.phone,
      },
      accessToken,
    });
  } catch (error) {
    console.error("Error during user registration:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error. Please try again later.",
    });
  }
});


// Route for user login -- for demo app set-up
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }
    
    // Check if password matches
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }
    
    // Generate JWT token
    const token = jwt.sign({ userId: user._id }, 'your_jwt_secret', { expiresIn: '1h' });
    
    res.json({ message: 'Login successful', token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});



module.exports = router;
