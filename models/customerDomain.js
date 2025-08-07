const mongoose = require('mongoose');

const customerDomainSchema = new mongoose.Schema({
  // Company information
  companyName: {
    type: String,
    required: [true, 'Company name is required'],
    trim: true
  },
  stockSymbol: {
    type: String,
    required: [true, 'Stock symbol is required'],
    trim: true,
    uppercase: true
  },
  companyWebsite: {
    type: String,
    required: [true, 'Company website is required'],
    trim: true
  },
  
  // Domain configuration
  subdomain: {
    type: String,
    required: [true, 'Subdomain is required'],
    trim: true,
    unique: true
  },
  mappedTo: {
    type: String,
    required: [true, 'Mapping destination is required'],
    trim: true
  },

  // DNS Validation details for Let's Encrypt DNS-01 challenge
  dnsValidation: new mongoose.Schema({
    name: {
      type: String,
      trim: true
    },
    type: {
      type: String,
      trim: true
    },
    value: {
      type: String,
      trim: true
    }
  }, { _id: false }), // Disable _id for this nested schema
  
  // Status tracking for Let's Encrypt validation flow
  status: {
    type: String,
    enum: ['pending', 'dns_validation', 'active', 'certificate_issued', 'error'],
    default: 'pending'
  },

  // Timestamp of the last DNS check
  lastCheckedAt: Date,

  // Error message if any during validation
  errorMessage: {
    type: String,
    trim: true
  },

  // User reference for this domain (customer who owns the domain)
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, 
{ 
  timestamps: true 
});

// Index for faster lookups
customerDomainSchema.index({ user: 1 });
customerDomainSchema.index({ stockSymbol: 1 });

module.exports = mongoose.model('CustomerDomain', customerDomainSchema);
