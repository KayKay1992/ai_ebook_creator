require('dotenv').config();
const connectDB = require('./config/db');
const app = require('./app');

//connect Database
connectDB();

//start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
