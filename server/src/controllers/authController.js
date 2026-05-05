const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { User } = require('../models');
const { generateOTP } = require('../utils/helpers');
const EmailService = require('../services/emailService');
const NotificationService = require('../services/notificationService');

// Store OTPs temporarily (in production, use Redis or database)
const otpStore = new Map();
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

class AuthController {
  // Register new user
  static async register(req, res) {
    try {
      const { name, email, password, role } = req.body;
      const normalizedEmail = normalizeEmail(email);

      if (!normalizedEmail) {
        return res.status(400).json({ message: 'Email is required' });
      }
      
      // Check if user exists
      const existingUser = db.users.find(u => normalizeEmail(u.email) === normalizedEmail);
      if (existingUser) {
        return res.status(400).json({ message: 'User already exists' });
      }
      
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);
      
      // Create user
      const userData = {
        id: db.getNextId(),
        name,
        email: normalizedEmail,
        password: hashedPassword,
        role: role || 'learner',
        isOnline: true
      };
      
      const user = new User(userData);
      db.users.push(user);
      db.save(); // Save immediately after user registration
      
      // Generate token
      const token = jwt.sign(
        { id: user.id },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '7d' }
      );
      
      res.status(201).json({
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          subjects: user.subjects || [],
          isOnline: user.isOnline,
          rating: user.rating || 0,
          reviewCount: user.reviewCount || 0,
          createdAt: user.createdAt,
          isVerified: user.isVerified || false,
          verificationStatus: user.verificationStatus || 'pending',
          certificateUrl: user.certificateUrl || null
        }
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }

  // Login user
  static async login(req, res) {
    try {
      const { email, password } = req.body;
      const normalizedEmail = normalizeEmail(email);
      
      // Validate input
      if (!normalizedEmail || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
      }
      
      // Find all accounts for this email (guards against historical duplicate rows)
      const matchingUsers = db.users.filter(u => normalizeEmail(u.email) === normalizedEmail);
      if (matchingUsers.length === 0) {
        return res.status(400).json({ message: 'Invalid credentials' });
      }

      let user = null;
      for (const candidate of matchingUsers) {
        if (!candidate.password || typeof candidate.password !== 'string') {
          continue;
        }

        const isMatch = await bcrypt.compare(password, candidate.password);
        if (isMatch) {
          user = candidate;
          break;
        }
      }

      if (!user) {
        return res.status(400).json({ message: 'Invalid credentials' });
      }
      
      // Generate token
      const token = jwt.sign(
        { id: user.id },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '7d' }
      );
      
      // Set user online when they login
      user.isOnline = true;
      db.save(); // Save user online status
      
      res.json({
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          subjects: user.subjects || [],
          isOnline: user.isOnline,
          rating: user.rating || 0,
          reviewCount: user.reviewCount || 0,
          createdAt: user.createdAt,
          isVerified: user.isVerified || false,
          verificationStatus: user.verificationStatus || 'pending',
          certificateUrl: user.certificateUrl || null,
          certificateRejectionReason: user.certificateRejectionReason || null
        }
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }

  // Logout user
  static async logout(req, res) {
    try {
      const user = db.users.find(u => u.id === req.user.id);
      if (user) {
        user.isOnline = false;
        db.save(); // Save user offline status
      }
      
      res.json({ message: 'Logged out successfully' });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }

  // Forgot Password - Send OTP
  static async forgotPassword(req, res) {
    try {
      const { email } = req.body;
      const normalizedEmail = normalizeEmail(email);
      
      const user = db.users.find(u => normalizeEmail(u.email) === normalizedEmail);
      if (!user) {
        return res.status(404).json({ message: 'User not found with this email' });
      }
      
      // Generate OTP
      const otp = generateOTP();
      
      // Store OTP with expiration (5 minutes)
      otpStore.set(normalizedEmail, {
        otp,
        expiresAt: Date.now() + 5 * 60 * 1000,
        userId: user.id
      });
      
      // Send OTP email
      await EmailService.sendOTPEmail(user.email, user.name, otp);
      
      res.json({ message: 'OTP sent to your email address' });
    } catch (error) {
      console.error('Error sending OTP:', error);
      res.status(500).json({ message: 'Failed to send OTP' });
    }
  }

  // Verify OTP
  static verifyOTP(req, res) {
    try {
      const { email, otp } = req.body;
      const normalizedEmail = normalizeEmail(email);
      
      const storedOtpData = otpStore.get(normalizedEmail);
      if (!storedOtpData) {
        return res.status(400).json({ message: 'OTP not found or expired' });
      }
      
      if (Date.now() > storedOtpData.expiresAt) {
        otpStore.delete(normalizedEmail);
        return res.status(400).json({ message: 'OTP has expired' });
      }
      
      if (storedOtpData.otp !== otp) {
        return res.status(400).json({ message: 'Invalid OTP' });
      }
      
      res.json({ 
        message: 'OTP verified successfully',
        userId: storedOtpData.userId 
      });
    } catch (error) {
      console.error('Error verifying OTP:', error);
      res.status(500).json({ message: 'Failed to verify OTP' });
    }
  }

  // Reset Password
  static async resetPassword(req, res) {
    try {
      const { email, otp, newPassword } = req.body;
      const normalizedEmail = normalizeEmail(email);
      
      const storedOtpData = otpStore.get(normalizedEmail);
      if (!storedOtpData || storedOtpData.otp !== otp) {
        return res.status(400).json({ message: 'Invalid or expired OTP' });
      }
      
      // Find user and update password
      const user = db.users.find(u => u.id === storedOtpData.userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      // Hash the new password before storing
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      user.password = hashedPassword;
      db.save(); // Save password change
      
      // Remove OTP from store
      otpStore.delete(normalizedEmail);
      
      res.json({ message: 'Password reset successfully' });
    } catch (error) {
      console.error('Error resetting password:', error);
      res.status(500).json({ message: 'Failed to reset password' });
    }
  }

  // Upload Certificate
  static async uploadCertificate(req, res) {
    try {
      const user = db.users.find(u => u.id === req.user.id);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      if (user.role !== 'tutor') {
        // Keep upload unblocked when role is stale in persisted data.
        user.role = 'tutor';
        if (!Array.isArray(user.subjects)) {
          user.subjects = [];
        }
      }

      if (!req.file) {
        return res.status(400).json({ message: 'Please upload a certificate file' });
      }

      // Save certificate URL (relative path)
      user.certificateUrl = `/uploads/certificates/${req.file.filename}`;
      user.verificationStatus = 'pending';
      user.certificateRejectionReason = null;
      db.save();

      // Notify all admins
      const admins = db.users.filter(u => u.role === 'admin');
      admins.forEach(admin => {
        NotificationService.sendNotification(admin.id, {
          message: `${user.name} has uploaded a certificate for verification`,
          type: 'certificate_uploaded'
        });
      });

      res.json({ 
        message: 'Certificate uploaded successfully. Awaiting admin verification.',
        certificateUrl: user.certificateUrl,
        verificationStatus: user.verificationStatus
      });
    } catch (error) {
      console.error('Error uploading certificate:', error);
      res.status(500).json({ message: 'Failed to upload certificate' });
    }
  }
}

module.exports = AuthController;