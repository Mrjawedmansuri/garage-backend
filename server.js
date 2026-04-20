const express = require('express');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const cors = require('cors');
const nodemailer = require('nodemailer');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.json());

// Database connection pool
const pool = require('./db');

// Test database connection route
app.get('/api/test-db', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    res.json({ message: 'Database connection successful!' });
  } catch (error) {
    console.error('Database connection failed:', error);
    res.status(500).json({ error: 'Database connection failed', details: error.message });
  }
});

// Authentication Routes
app.post('/api/auth/login', async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ success: false, message: 'Email/Phone and password are required' });
  }

  try {
    const [rows] = await pool.query(
        'SELECT * FROM users WHERE phone = ? OR email = ?', 
        [identifier, identifier]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = rows[0];

    // In a real app, compare hashed password using bcrypt. For now, simple text match.
    if (user.password !== password) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Don't send password back in response
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      success: true,
      message: 'Login successful',
      user: userWithoutPassword
    });

  } catch (error) {
    console.error('Detailed Error object:', error);
    console.error('Login error message:', error.message);
    res.status(500).json({ success: false, message: 'Server error during login', error: error.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { name, username, phone, email, password } = req.body;
  
  if (!name || !username || !phone || !email || !password) {
    return res.status(400).json({ success: false, message: 'All fields are required' });
  }

  try {
    // Check if user already exists
    const [existingUsers] = await pool.query(
      'SELECT * FROM users WHERE phone = ? OR email = ? OR username = ?', 
      [phone, email, username]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'User with this phone, email, or username already exists' 
      });
    }

    // Insert new user
    // In a real app, hash the password before saving
    const [result] = await pool.query(
      'INSERT INTO users (name, username, phone, email, password, role) VALUES (?, ?, ?, ?, ?, ?)',
      [name, username, phone, email, password, 'admin']
    );

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      userId: result.insertId
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Server error during registration', error: error.message });
  }
});

// Forgot Password Flow
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      // Prevent email enumeration
      return res.json({ success: true, message: 'If you have an account, a reset code has been sent.' });
    }

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit code
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
    const formattedExpiry = expiry.toISOString().slice(0, 19).replace('T', ' ');

    await pool.query('UPDATE users SET reset_code = ?, reset_expiry = ? WHERE email = ?', [resetCode, formattedExpiry, email]);

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Garage Admin Password Reset',
      text: `Your password reset code is: ${resetCode}\n\nThis code will expire in 15 minutes.`
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error('Mail Error:', error);
        return res.status(500).json({ success: false, message: 'Failed to send reset email. Ensure EMAIL_USER and EMAIL_PASS are set in backend .env' });
      } else {
        return res.json({ success: true, message: 'Reset code sent successfully' });
      }
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) return res.status(400).json({ success: false, message: 'Missing fields' });

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ? AND reset_code = ?', [email, code]);
    
    if (rows.length === 0) return res.status(400).json({ success: false, message: 'Invalid or expired reset code' });

    const user = rows[0];
    const expiry = new Date(user.reset_expiry);
    
    if (Date.now() > expiry.getTime()) {
      return res.status(400).json({ success: false, message: 'Reset code has expired. Please request a new one.' });
    }

    await pool.query('UPDATE users SET password = ?, reset_code = NULL, reset_expiry = NULL WHERE email = ?', [newPassword, email]);
    
    res.json({ success: true, message: 'Password reset successful!' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`======================================================`);
  console.log(`✅ EXPO AUTO-DISCOVERY ENABLED.`);
  console.log(`Frontend will automatically detect and connect to this PC.`);
  console.log(`======================================================`);
});

// Prevent Node 24 clean exit bug
setInterval(() => {}, 1000 * 60 * 60);

// Use routes (after export to avoid circular dependency issues in simple setups)
const jobcardRoutes = require('./routes/jobcards');
const inventoryRoutes = require('./routes/inventory');
const financeRoutes = require('./routes/finance');
const settingsRoutes = require('./routes/settings');

// Require authentication for data routes
const requireGarageId = require('./middleware/auth');

app.use('/api/jobcards', requireGarageId, jobcardRoutes);
app.use('/api/inventory', requireGarageId, inventoryRoutes);
app.use('/api/finance', requireGarageId, financeRoutes);
app.use('/api/settings', requireGarageId, settingsRoutes);

// No longer need to export pool here
