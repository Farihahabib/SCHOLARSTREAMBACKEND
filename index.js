require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion,ObjectId } = require('mongodb')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const admin = require('firebase-admin')
const port = process.env.PORT || 3000
const decoded = Buffer.from(process.env.SS_SERVICE_KEY, 'base64').toString(
  'utf-8'
)
const serviceAccount = JSON.parse(decoded)
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

const app = express()
// middleware
app.use(
  cors({
    origin: [process.env.CLIENT_DOMAIN],
    credentials: true,
    optionSuccessStatus: 200,
  })
)
app.use(express.json())

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(' ')[1]
  console.log(token)
  if (!token) return res.status(401).send({ message: 'Unauthorized Access!' })
  try {
    const decoded = await admin.auth().verifyIdToken(token)
    req.tokenEmail = decoded.email
    console.log(decoded)
    next()
  } catch (err) {
    console.log(err)
    return res.status(401).send({ message: 'Unauthorized Access!', err })
  }
}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {
  try {
  const db = client.db('ScholarStream')
  const scholarshipCollection = db.collection('Scholarships')
  const applyCollection = db.collection('applys')
 //post scholarship data
  app.post('/scholarships',async(req,res)=>{
    const scholarshipData = req.body;
    const result = await scholarshipCollection.insertOne(scholarshipData)
    res.send(result)
  })
//get all scholarships
app.get('/scholarships',async(req,res)=>{
    const result = await scholarshipCollection.find().toArray()
     res.send(result)
})
//get single scholarship
app.get('/scholarships/:id',async(req,res)=>{
  const id = req.params.id;
    const result = await scholarshipCollection.findOne({_id: new ObjectId(id)})
     res.send(result)
})
 // search and filter scholarships
//  app.get('/scholarships', async (req, res) => {
//     try {
//       const { search, country, sortBy, order, page = 1, limit = 8 } = req.query;

//       const query = {};
//       if (search) query.universityName = { $regex: search, $options: 'i' };
//       if (country) query.country = country;

//       let cursor = scholarshipCollection.find(query);

//       // Sort
//       if (sortBy) {
//         const sortOrder = order === 'desc' ? -1 : 1;
//         cursor = cursor.sort({ [sortBy]: sortOrder });
//       }

//       // Pagination
//       const pageNum = parseInt(page);
//       const pageLimit = parseInt(limit);
//       const total = await scholarshipCollection.countDocuments(query);
//       const scholarships = await cursor
//         .skip((pageNum - 1) * pageLimit)
//         .limit(pageLimit)
//         .toArray();

//       res.send({
//         scholarships,
//         total,
//         page: pageNum,
//         pages: Math.ceil(total / pageLimit),
//       });
//     } catch (err) {
//       console.error(err);
//       res.status(500).send({ error: 'Something went wrong' });
//     }
//   })

// payment endpoint
 app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      // console.log(paymentInfo)
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'usd',
         unit_amount: paymentInfo?.applicationFees * 100,
              product_data: {
                name: paymentInfo?.scholarshipName,
                images: [paymentInfo.image],
              },
             
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo?.Student?.email,
        mode: 'payment',
        metadata: {
          scholarshipId: paymentInfo?.scholarshipId,
          customer: paymentInfo?.Student?.email,
        },
        success_url: `${process.env.CLIENT_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_DOMAIN}/dashboard`,
      })
      res.send({ url: session.url })
    })

app.post('/payment-success', async (req, res) => {
      const { sessionId } = req.body
      const session = await stripe.checkout.sessions.retrieve(sessionId)
      
      console.log('payment-session',session)
      const  scholarship = await scholarshipCollection.findOne({_id:
         new ObjectId(session.metadata.scholarshipId)})
      // console.log(session)
      const apply = await applyCollection.findOne({
        tranjectionId: session.payment_intent,
      })
      if (session.status === 'complete' && scholarship && !apply) {
        const applyInfo = {
          scholarshipId: session.metadata.scholarshipId,
          tranjectionId: session.payment_intent,
          student : session.metadata.customer,
          moderator:session.moderator,
          status: 'pending',
          scholarshipName: scholarship.scholarshipName,
          universityName: scholarship.universityName,
          applicationFees: scholarship.applicationFees,
          country: scholarship.country,
          city: scholarship.city,
          degree: scholarship.degree,
          subjectCategory: scholarship.subjectCategory,

          amount: session.amount_total / 100,
        }
          const result = await applyCollection.insertOne(applyInfo)
      }
      res.send(scholarship)

})

//get all applys for a student by email
app.get('/my-applications/:email',async(req,res)=>{
const email = req.params.email;
const result = await applyCollection.find({student:email}).toArray()
  res.send(result)

})
//get all applys for moderator by email
app.get('/moderator-applications/:email',async(req,res)=>{
const email = req.params.email;
const result = await scholarshipCollection.find({'moderator.email':email}).toArray()
  res.send(result
  )  }
)










    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from Server..')
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})