const express = require('express');
const CustomerDomain = require('../models/customerDomain'); 
const authMiddleware = require('../middlewares/authMiddleware');
const router = express.Router();

// Route to create a new customer domain configuration
const User = require('../models/User'); 

router.post('/', async (req, res) => {
  try {
    const { companyName, stockSymbol, companyWebsite, subdomain, mappedTo, customerDNSProvider, userId } = req.body;

    // Find the user by ID (ensure the user exists)
    const user = await User.findById(userId);
    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    // Create a new customer domain configuration
    const customerDomain = new CustomerDomain({
      companyName,
      stockSymbol,
      companyWebsite,
      subdomain,
      mappedTo,
      customerDNSProvider,
      user: user._id, 
    });
    
    await customerDomain.save();
    
    res.status(201).json({ message: 'Customer domain configuration created successfully', customerDomain });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});


// Route to fetch all customer domains
router.get('/', async (req, res) => {
  try {
    const customerDomains = await CustomerDomain.find();
    res.json(customerDomains);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Route to fetch a single customer domain by subdomain
router.get('/:subdomain', async (req, res) => {
  try {
    const customerDomain = await CustomerDomain.findOne({ subdomain: req.params.subdomain });
    if (!customerDomain) {
      return res.status(404).json({ message: 'Customer domain not found' });
    }
    res.json(customerDomain);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Route to update a customer domain's status or DNS configuration (for example, DNS validation)
router.put('/:subdomain', async (req, res) => {
  try {
    const { status, dnsValidation } = req.body;
    
    const updatedCustomerDomain = await CustomerDomain.findOneAndUpdate(
      { subdomain: req.params.subdomain },
      { status, dnsValidation },
      { new: true }
    );
    
    if (!updatedCustomerDomain) {
      return res.status(404).json({ message: 'Customer domain not found' });
    }
    
    res.json({ message: 'Customer domain updated successfully', updatedCustomerDomain });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
