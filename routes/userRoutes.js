const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User'); 
const router = express.Router();


const { DNSProvider } = require('../utils/DNSProvider');  // DNS provider helper (e.g., GoDaddy, Route53, etc.)

const createCustomerDomainAfterRegistration = async (user) => {
  try {
    const companySlug = user.companyname.replace(/\s+/g, '-').toLowerCase();
    const subdomain = `investor.${user.domain}`;  // Subdomain for the user
    const stockSymbol = user.stock_ticker_symbol.toLowerCase();
    const mappedTo = `${stockSymbol}.getirnow.com`;  // Mapping destination for the subdomain

    // Check if subdomain already exists
    const existingDomain = await CustomerDomain.findOne({ subdomain });
    if (existingDomain) {
      console.log(`Subdomain ${subdomain} already exists.`);
      return;
    }

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

    // Request SSL certificate from Let's Encrypt (this will be done later)
    try {
      const certificateArn = await requestCertificate(subdomain); // Later you’ll integrate Let's Encrypt API here
      customerDomain.certificateArn = certificateArn;
      customerDomain.status = 'dns_validation';  // Set status to DNS validation

      // Get DNS validation records from Let's Encrypt
      const dnsValidationData = await getDNSValidation(certificateArn); // You'll implement this
      console.log("DNS Validation Record:", dnsValidationData);

      const { name, type, value } = dnsValidationData;

      // Set DNS validation data on the customer domain record
      if (dnsValidationData) {
        customerDomain.dnsValidation = {
          name,
          type,
          value
        };
      } else {
        customerDomain.errorMessage = 'DNS validation records not yet available from AWS. Please try again later.';
        console.log(`DNS validation records not yet available for ${subdomain}.`);
      }

      // Save customer domain
      await customerDomain.save();
      console.log(`Customer domain created successfully for ${user.companyname} mapped to ${mappedTo}`);

      // If DNS validation data is ready, continue to certificate issuance
      if (dnsValidationData) {
        // In production, you will set this up to create CloudFront distribution after certificate is issued
        const AUTO_CREATE_DISTRIBUTION = process.env.AUTO_CREATE_DISTRIBUTION === 'true';
        if (AUTO_CREATE_DISTRIBUTION) {
          console.log(`Attempting to check certificate status for ${subdomain}...`);
          const isIssued = await waitForCertificate(certificateArn, 1); // Poll for certificate issuance
          if (isIssued) {
            console.log(`Certificate issued for ${subdomain}, creating CloudFront distribution...`);
            customerDomain.status = 'certificate_issued';
            await customerDomain.save();
            // Create CloudFront distribution
            const cloudfrontDomain = await createCloudFrontDistribution(subdomain, certificateArn, mappedTo);
            if (cloudfrontDomain) {
              customerDomain.cloudfrontDomain = cloudfrontDomain;
              customerDomain.status = 'cloudfront_created';
              await customerDomain.save();
              console.log(`CloudFront domain name saved for ${subdomain}: ${cloudfrontDomain}`);
            }
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
exports.signup = async (req, res) => {
  try {
    const { data } = req.body;
    const decryptedBytes = CryptoJS.AES.decrypt(
      data,
      process.env.DECRYPT_SECRET_KEY
    );
    const decryptedText = decryptedBytes.toString(CryptoJS.enc.Utf8);

    if (!decryptedText) {
      return res.status(400).json({
        success: false,
        message: "Invalid or tampered encrypted data.",
      });
    }

    const decryptedPayload = JSON.parse(decryptedText);

    const {
      firstname,
      lastname,
      companyname,
      domain,
      email,
      phone,
      stock_ticker_symbol,
      password,
    } = decryptedPayload;

    if (
      !(
        firstname &&
        companyname &&
        domain &&
        email &&
        stock_ticker_symbol
      )
    ) {
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

    // Check if the domain is valid
    const domainRegex = /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}$/;
    if (!domainRegex.test(domain)) {
      return res.status(400).json({
        success: false,
        message: "Invalid domain name (e.g. company.com, mydomain.org)",
      });
    }

    // Check if email, company name, and domain already exist
    const emailExists = await userModel.findOne({ email });
    const companyExists = await userModel.findOne({ companyname });
    const domainExist = await userModel.findOne({ domain });

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

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create the new user with domain
    const newUser = new userModel({
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

    // Call function to create customer domain after registration
    setTimeout(async () => {
      await createCustomerDomainAfterRegistration(newUser);
    }, 0);

    // Generate tokens and send response
    const accessToken = generateAccessToken(newUser);
    await logActivity(newUser._id, `Investor ${newUser.companyname} Successfully Registered`);

    // Send registration email
    await registration(newUser.email);

    return res.status(200).json({
      success: true,
      message: "Welcome to the platform 🎉",
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
};

// Route for user registration
router.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
  try {  
    // Check if the user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }
    
    // Create a new user
    const newUser = new User({ name, email, password });
    
    // Hash password before saving
    newUser.password = await bcrypt.hash(password, 10);
    
    // Save the user to the database
    await newUser.save();
    
    res.status(201).json({ message: 'User registered successfully', user: newUser });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Route for user login
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
