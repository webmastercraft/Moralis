const express = require("express");
const cors = require('cors');
const { getTokenBalances, getComplexProtocolLists } = require('./utils/index.js');

const app = express();

app.use(cors());

// routes
const router = require('./routes/api/router');

// Init Middleware
app.use(express.json());
app.use(express.urlencoded({
    extended: false
}));

// use Routes
app.use('/api/', router);

let PORT = 2083;


app.listen(PORT, () => {
    console.log(`Server running at (http://localhost:${PORT})`);
});

// getTokenBalances('polygon', '0x704111eDBee29D79a92c4F21e70A5396AEDCc44a').then(result => console.log(result)).catch((e)=>console.log(e));
// getComplexProtocolLists('0x3ddfa8ec3052539b6c9549f12cea2c295cff5296').then(result => console.log(result)).catch((e)=>console.log(e));