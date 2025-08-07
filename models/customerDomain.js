const mongoose = require('mongoose');

// Schema for customer domain configuration
const customerDomainSchema = new mongoose.Schema({
  companyName: {
    type: String,
    required: true,
    trim: true
  },
  stockSymbol: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  companyWebsite: {
    type: String,
    required: true,
    trim: true
  },
  subdomain: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  mappedTo: {
    type: String,
    required: true,
    trim: true
  },
  customerDNSProvider: {
    type: String,
    trim: true
  },
  certificateArn: {
    type: String,
    trim: true
  },
  cloudfrontDomain: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'dns_validation', 'certificate_issued', 'cloudfront_created', 'active', 'verified', 'error'],
    default: 'pending'
  },
  dnsValidation: new mongoose.Schema({
    name: { type: String, trim: true },
    type: { type: String, trim: true },
    value: { type: String, trim: true }
  }, { _id: false }), 
  lastCheckedAt: Date,
  errorMessage: { type: String },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

module.exports = mongoose.model('CustomerDomain', customerDomainSchema);
