const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * Minimal Schema for User
 * Stores basic user information.
 */
const userSchema = new mongoose.Schema({
  // User's personal information
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: [true, 'Password is required']
  },
  
  // User's role or type (if needed, for example: admin, customer, etc.)
  role: {
    type: String,
    enum: ['admin', 'customer'],
    default: 'customer'
  },

  // Status tracking (active/inactive)
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },

  // Timestamps for record tracking
  lastLogin: {
    type: Date
  },

  createdAt: {
    type: Date,
    default: Date.now
  },

  updatedAt: {
    type: Date
  }
}, 
{ 
  timestamps: true 
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

module.exports = mongoose.model('User', userSchema);
