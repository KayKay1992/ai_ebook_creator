require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoute');
const bookRoutes = require('./routes/bookRoute');
const aiRoutes = require('./routes/aiRoute');

const app = express();

//middleware to handle CORS
app.use(cors({
    origin: '*', // allow all origins
    methods: ['GET', 'POST', 'PUT', 'DELETE'], // allow specific HTTP methods
    allowedHeaders: ['Content-Type', 'Authorization'] // allow specific headers
}

));

//connect Database
connectDB();

//init middleware
app.use(express.json());

//static folder for uploads 
app.use('/backend/uploads', express.static(path.join(__dirname, 'uploads')));


//define routes
app.use('/api/auth', authRoutes);
app.use('/api/books', bookRoutes);
app.use('/api/ai', aiRoutes);

//start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));