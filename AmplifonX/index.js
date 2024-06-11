require('dotenv').config();

const express                = require('express');
const bodyParser             = require('body-parser');
const jwt                    = require('jsonwebtoken');
const bcrypt                 = require('bcryptjs');
const sql                    = require('mssql');
const cors                   = require('cors');
const amplifon_app           = express();
const port                   = 3000;
const jwtSecret              = 'anakin_skywalker';
const maxFailedLoginAttempts = 10;
const userRoles              = {
                                 Admin: 'A',
                                 Seller: 'S',
                                 Manager: 'M',
                               }

amplifon_app.use(cors());
amplifon_app.use(bodyParser.json());

amplifon_app.listen(port, () => {
    console.log(`AmplifonX Server running on http://localhost:${port}`);
});

amplifon_app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', true);
    next();
});

//__________________________SECURITY 

const memoryStore = {};

const ipRateLimiter = (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    
    if (!memoryStore[ip]) {
        memoryStore[ip] = [];
    }

    memoryStore[ip] = memoryStore[ip].filter(timestamp => now - timestamp < 2 * 60 * 1000);

    if (memoryStore[ip].length >= maxFailedLoginAttempts) {
        return res.status(429).send({ response :  'Too many login attempts. Try again later.' });
    }

    next();
};

const trackLoginAttempts = (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();

    if (!memoryStore[ip]) {
        memoryStore[ip] = [];
    }

    memoryStore[ip].push(now);
    next();
};

setInterval(() => {
    const now = Date.now();
    for (const ip in memoryStore) {
        memoryStore[ip] = memoryStore[ip].filter(timestamp => now - timestamp < 2 * 60 * 1000);
        if (memoryStore[ip].length === 0) {
            delete memoryStore[ip];
        }
    }
}, 60 * 1000);

//__________________________DB MANAGEMENT

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        enableArithAbort: process.env.DB_ENABLE_ARITH_ABORT === 'true'
    }
};

const beginTransaction = async () => {
    const transaction = new sql.Transaction();
    await transaction.begin();
    return transaction;
};

const commitTransaction = async (transaction) => {
    await transaction.commit();
};

const rollbackTransaction = async (transaction) => {
    await transaction.rollback();
};

sql.connect(dbConfig, (err) => {
    if (err) console.log(err);
    else console.log('Database connected');
});

amplifon_app.post('/clearDatabase', async (req, res) => {
    let transaction;
    try {
        transaction = await beginTransaction();

        const request = new sql.Request();

        await request.query`
            DELETE FROM Sales;
        `;

        await request.query`
            DELETE FROM Stores;
        `;

        await request.query`
            DELETE FROM Users;
        `;

        await commitTransaction(transaction);

        res.send({ response: 'Database cleared!' });
    } catch (err) {
        if (transaction) await rollbackTransaction(transaction);
        res.status(500).send({ error: err.message });
    }
});

//__________________________AUTHENTICATION AND USER APIS

const authenticateJWT = (req, res, next) => {
    const token = req.header('Authorization');
    if (token) {
        jwt.verify(token, jwtSecret, (err, user) => {
            if (err) {
                return res.send({ response : '403 Forbidden - Your role is not authorized to access this API' });
            }
            req.user = user;
            next();
        });
    } else {
        res.send({ response : '401 Unauthorized - Who are you? API ACCESS DENIED!' });
    }
};

const authorize = (roles = []) => {
    if (typeof roles === 'string') {
        roles = [roles];
    }
    return [
        authenticateJWT,
        (req, res, next) => {
            if (roles.length && !roles.includes(req.user.role)) {
                return res.send({ response : '403 Forbidden - Your role is not authorized to access this API' });
            }
            next();
        }
    ];
};

amplifon_app.post('/signup', async (req, res) => {
    const { Email, Password, Role } = req.body;
    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(Password, salt);
    let transaction;

    try {
        if(!Email || !Password || !Role) {
            res.send({ response :'Missing signup parameters!' });
            return
        }

        transaction = await beginTransaction();

        const request = new sql.Request();
        request.input('Email', sql.NVarChar, Email);
        request.input('Password', sql.NVarChar, hashedPassword);
        request.input('Role', sql.NVarChar, Role);

        await request.query`
            INSERT INTO Users (Email, Password, Role)
            VALUES (@Email, @Password, @Role)
        `;
        await commitTransaction(transaction);

        res.status(201).send({ response : 'User created, welcome in the Amplifon Store!'});
    } catch (err) {
        if (transaction) await rollbackTransaction(transaction);
        res.status(500).send({ response :err.message });
    }
});

amplifon_app.post('/login', ipRateLimiter, async (req, res) => {
    const { Email, Password } = req.body;
    
    try {
        const request = new sql.Request();

        if(!Email || !Password) {
            res.send({ response : 'Missing login parameters!' });
            return
        }

        request.input('Email', sql.NVarChar, Email);

        const userResult = await request.query`SELECT * 
                                                 FROM Users 
                                                WHERE email = @Email`;

        const user = userResult.recordset[0];

        if (!user || !await bcrypt.compare(Password, user.password)) {
            trackLoginAttempts(req, res, () => {});
            return res.status(401).send({ response : (!user ? 'User not found' : 'Invalid password') });
        }
        
        if (memoryStore[req.ip]) {
            delete memoryStore[req.ip];
        }
    
        
        const token = jwt.sign(
            { id: user.id, role: user.role },
            jwtSecret,
            { expiresIn: '2h' }
        );
        
        res.send({ token });
    } catch (err) {
        res.status(500).send({ response :err.message });
    }
});

//__________________________STORES APIS

amplifon_app.post('/addStore', authorize([userRoles.Admin, userRoles.Manager]), async (req, res) => {
    const { Name, City } = req.body;
    let transaction;
    try {
        if(!Name || !City) {
            res.send({ response : 'Missing store parameters!' });
            return
        }

        transaction = await beginTransaction();

        const request = new sql.Request();
        request.input('Name', sql.NVarChar, Name);
        request.input('City', sql.NVarChar, City);

        const result = await request.query`INSERT INTO Stores (name, city) 
                                           OUTPUT INSERTED.id 
                                           VALUES (@Name, @City)`;
        await commitTransaction(transaction);

        res.status(201).send({ response : {  store_id: result.recordset[0].id }});
    } catch (err) {
        if (transaction) await rollbackTransaction(transaction);
        res.status(500).send({ response :err.message });
    }
});

amplifon_app.get('/getStore', authorize([userRoles.Admin, userRoles.Seller, userRoles.Manager]), async (req, res) => {
    const { Id } = req.query;
    let transaction;

    try {
        const request = new sql.Request();
        request.input('Id', sql.Int, Id);

        if(!Id) {
            res.send({ response : 'Missing store id!' });
            return
        }

        transaction = await beginTransaction();

        const storeResult = await request.query`SELECT * 
                                                  FROM Stores 
                                                 WHERE id = @Id`;

        if (storeResult.recordset.length === 0) {
            return res.status(404).send({ response : 'Store not found' });
        }

        const totalSalesResult = await request.query`SELECT SUM(total_amount) AS TotalSales 
                                                       FROM Sales 
                                                      WHERE store_id = @Id`;
        const salesHistoryResult = await request.query`SELECT Convert(varchar,Sales.sale_date,103) as date, store_id, total_amount, id
                                                         FROM Sales 
                                                        WHERE store_id = @Id 
                                                        ORDER BY sale_date DESC`;

        const store = storeResult.recordset[0];
        store.TotalSales = totalSalesResult.recordset[0].TotalSales || 0;
        store.SalesHistory = salesHistoryResult.recordset;

        await commitTransaction(transaction);

        res.send({ response : store });
    } catch (err) {
        if (transaction) await rollbackTransaction(transaction);
        res.status(500).send({ response : err.message });
    }
});

amplifon_app.get('/getStores', authorize([userRoles.Admin, userRoles.Seller, userRoles.Manager]), async (req, res) => {
    var { Page = 1, PageSize = 5, Name = '', City = '' } = req.query;
    try {
        const offset = (Page - 1) * PageSize;

        const request = new sql.Request();
        request.input('Name', sql.NVarChar, '%' + Name.toLowerCase() + '%');
        request.input('City', sql.NVarChar, '%' + City.toLowerCase() + '%');
        request.input('Offset', sql.Int, offset);
        request.input('PageSize', sql.Int, PageSize);

        const result = await request.query`
            SELECT * FROM Stores
            WHERE LOWER(name) LIKE @Name 
              AND LOWER(city) LIKE @City
            ORDER BY id
           OFFSET @Offset ROWS 
            FETCH NEXT @PageSize ROWS ONLY
        `;
        res.send({ response : result.recordset });
    } catch (err) {
        res.status(500).send({ response : err.message });
    }
});

async function checkStoreExists(id) {
    const request = new sql.Request();
    request.input('Id', sql.Int, id);
    const result = await request.query`SELECT COUNT(*) AS count 
                                         FROM Stores 
                                        WHERE id = @Id`;
    return result.recordset[0].count > 0;
}

amplifon_app.put('/updateStore', authorize([userRoles.Admin,userRoles.Manager]), async (req, res) => {
    const { Id, Name, City } = req.body;
    let transaction;
    try {
        if(!Name || !Name || !City) {
            res.send({ response : 'Missing store parameters!' });
            return
        }

        transaction = await beginTransaction();

        const storeExists = await checkStoreExists(Id);
        if (!storeExists) {
            res.status(404).send({ response: 'Store not found!' });
            return;
        }

        const request = new sql.Request();
        request.input('Id', sql.Int, Id);
        request.input('Name', sql.NVarChar, Name);
        request.input('City', sql.NVarChar, City);

        await request.query`
            UPDATE Stores
               SET name = @Name, city = @City
             WHERE id = @Id
        `;
        await commitTransaction(transaction);

        res.send({ response : 'Store updated!' });
    } catch (err) {
        if (transaction) await rollbackTransaction(transaction);
        res.status(500).send({ response :err.message });
    }
});

amplifon_app.delete('/deleteStore', authorize([userRoles.Admin,userRoles.Manager]), async (req, res) => {
    const Id = req.body.Id;
    let transaction;
    try {
        if(!Id) {
            res.send({ response : 'Missing store id!' });
            return
        }

        transaction = await beginTransaction();

        const request = new sql.Request();
        request.input('Id', sql.Int, Id);

        await request.query`DELETE 
                              FROM Stores 
                             WHERE id = @Id`;
        await commitTransaction(transaction);

        res.send({ response : 'Store deleted!' });
    } catch (err) {
        if (transaction) await rollbackTransaction(transaction);
        res.status(500).send({ response : err.message });
    }
});

//__________________________SALES APIS

amplifon_app.post('/addSale', authorize([userRoles.Admin, userRoles.Seller]), async (req, res) => {
    const { Store_id, Total_amount, Sale_date } = req.body;
    let transaction;
    try {
        if(!Store_id || !Total_amount || !Sale_date) {
            res.send({ response : 'Missing sale parameters!' });
            return
        }

        transaction = await beginTransaction();

        const request = new sql.Request();
        request.input('Store_id', sql.Int, Store_id);
        request.input('Total_amount', sql.Float, Total_amount);
        request.input('Sale_date', sql.DateTime, Sale_date);

        const storeExists = await checkStoreExists(Store_id);
        if (!storeExists) {
            res.status(404).send({ response: 'Store not found!' });
            return;
        }

        const result = await request.query`
            INSERT INTO Sales (store_id, total_amount, sale_date)
            VALUES (@Store_id, @Total_amount, @Sale_date)
        `;
        await commitTransaction(transaction);

        res.status(201).send({ response : 'Sale created!' } );
    } catch (err) {
        if (transaction) await rollbackTransaction(transaction);
        res.status(500).send({ response : err.message });
    }
});

amplifon_app.get('/getSales', authorize([userRoles.Admin, userRoles.Manager]), async (req, res) => {
    const { Page = 1, PageSize = 10 } = req.query;
    try {
        const offset = (Page - 1) * PageSize;

        const request = new sql.Request();
        request.input('Offset', sql.Int, offset);
        request.input('PageSize', sql.Int, PageSize);

        const result = await request.query`
            SELECT * 
              FROM Sales
             ORDER BY sale_date DESC
            OFFSET @Offset ROWS
             FETCH NEXT @PageSize ROWS ONLY
        `;
        res.send({ response : result.recordset });
    } catch (err) {
        res.status(500).send({ response : err.message });
    }
});

amplifon_app.get('/leaderboard', authorize([userRoles.Admin, userRoles.Manager]), async (req, res) => {
    try {
        const result = await sql.query`
            SELECT Stores.name, 
                   SUM(Sales.total_amount) AS TotalSales
              FROM Stores
              JOIN Sales ON Stores.id = Sales.store_id
             GROUP BY Stores.name
             ORDER BY TotalSales DESC
        `;
        res.send({ response : result.recordset });
    } catch (err) {
        res.status(500).send({ response : err.message });
    }
});


