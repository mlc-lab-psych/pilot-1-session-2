const express = require('express');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, child, get, update, set } = require('firebase/database');
const dotenv = require('dotenv');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');



dotenv.config();

const firebaseConfig = {
    apiKey: process.env.AIRTABLE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
};

const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);

// Create an instance of an Express app
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// Define a route
app.get('/get-data', (req, res) => {

    let images = [];
    let test_stimuli = [];

    async function processCountData() {
        const dbRef = ref(database);
        try {
            const snapshot = await get(child(dbRef, 'count'));
            if (snapshot.exists()) {
                const countData = snapshot.val();

                function lowestValueAndKey(obj) {
                    let [lowestItems] = Object.entries(obj).sort(([ ,v1], [ ,v2]) => v1 - v2);
                    return lowestItems[0];
                }

                const key = lowestValueAndKey(countData)

                const updates = {};
                updates[`count/${key}`] = countData[key] + 1
                await update(dbRef,updates)

                return key

            } else {
                console.log("No count data available");
                return null;
            }
        } catch (error) {
            console.error("Error processing count data:", error);
        }
    }


    const setTable = processCountData().then((results) =>{
        let tableAirtable;
        switch (results) {
            case "table_one":
                tableAirtable = process.env.AIRTABLE_ALIVE_TABLE_1
                break;
            default:
                tableAirtable = process.env.AIRTABLE_ALIVE_TABLE_1
        }
        return tableAirtable
    }).then((tableAirtable)=>{
        let Airtable = async (base, table) => {

            const url = `https://api.airtable.com/v0/${base}/${table}`;
            let allRecords = [];
            let offset = null;

            try {
                do {
                    // Construct the URL with the offset if available
                    let fetchUrl = url;
                    if (offset) {
                        fetchUrl += `?offset=${offset}`;
                    }

                    const response = await fetch(fetchUrl, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
                            'Content-Type': 'application/json',
                        },
                    });

                    if (!response.ok) {
                        throw new Error(`Error: ${response.status} ${response.statusText}`);
                    }

                    const result = await response.json();

                    // Concatenate the current batch of records with the previous ones
                    allRecords = allRecords.concat(result.records);

                    // Set the offset for the next request, if available
                    offset = result.offset;

                } while (offset);  // Keep looping until there's no more offset

                return allRecords;  // Return all the records after fetching

            } catch (error) {
                console.log('Could not fetch data from Airtable.', error);
                return [];
            }
        }

        const data = Airtable(process.env.AIRTABLE_ALIVE_BASE, tableAirtable)

        data.then((result) =>{
            for(let rows in result){
                let temp_data = result[rows].fields
                let image_name;
                switch(temp_data['bucket'].split('/')[1]){
                    case "":
                        image_name = process.env.AWS_BUCKET_LINK + "/" + temp_data['item']
                        break;
                    case "Study2+resized+for+online":
                        image_name = process.env.AWS_BUCKET_TWO_LINK + "/" + temp_data['item']
                        break;
                    default:
                        image_name = process.env.AWS_BUCKET_LINK + "/" + temp_data['item']
                }
                images.push(image_name)
                temp_data['url'] = image_name
                test_stimuli.push(result[rows].fields)
            }
            images.push(process.env.AWS_BUCKET_LINK + "mask1.jpg")
        }).then((dataset) =>{
            res.status(200).json({
                test_stimuli: test_stimuli,
                images: images
            })
        })
    })

});

app.post('/submit-results', async (req, res) => {
    const results = req.body; // Get results from the request body
    // Helper function to remove undefined values
    function replaceNullWithString(obj) {
        return JSON.parse(JSON.stringify(obj, (key, value) => {
            if (value === null) {
                return "null";  // Replace null with the string "null"
            }
            return value;  // Keep the other values unchanged
        }));
    }

    // Clean the data to remove undefined values
    const cleanedData = replaceNullWithString(results);

    // Now save the cleaned data to Firebase
    const randomId = "user-" + Date.now().toString() + "-" + Math.floor(Math.random() * 1000000).toString();
    try{
        await set(ref(database, 'users-new/' + randomId), cleanedData)
            .then(() => {
                console.log('Data saved successfully.');
            })
        res.status(200).json({message: 'Results received successfully!'});
    } catch(error){
        console.error('Error saving data: ', error);
        res.status(500).json({ message: 'Error saving results.' });
    }
});

app.get('*', (req, res) => {
    res.redirect('/');
});

// Set the app to listen on port 3000
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
