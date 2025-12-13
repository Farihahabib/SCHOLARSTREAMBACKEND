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
  const usersCollection = db.collection('users')
  const reviewsCollection = db.collection('reviews')
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

app.delete('/scholarships/:id',async(req,res)=>{
  const {id} = req.params
const objectId = new ObjectId(id)
const filter = {_id: objectId}
  const result = await scholarshipCollection.deleteOne(filter)
  res.send(result)

})

//get single scholarship
app.get('/scholarships/:id',async(req,res)=>{
  const id = req.params.id;
    const result = await scholarshipCollection.findOne({_id: new ObjectId(id)})
     res.send(result)
})

// payment endpoint
 app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      console.log(paymentInfo)
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
         console.log('scholarship',scholarship)
      console.log(session)
      const apply = await applyCollection.findOne({
        tranjectionId: session.payment_intent,
      })
      if (session.status === 'complete' && scholarship && !apply) {
        const applyInfo = {
          scholarshipId: session.metadata.scholarshipId,
          tranjectionId: session.payment_intent,
          student : session.metadata.customer,
          studentName : scholarship.moderator.name,
          studentEmail : session.customer_details.email,
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
//get all applys 
app.get('/applications',async(req,res)=>{
const result = await applyCollection.find().toArray()
  res.send(result)

})

// update application status
app.patch('/applications/status/:id',async(req,res)=>{
  const id = req.params.id;
  const {status} = req.body;
  const objectId = new ObjectId(id);
  const result = await applyCollection.updateOne({_id:objectId},{$set:{status}} )
  res.send({
    success:true,
    message:'Application status updated successfully',
    result
  })
 

})
//post review
app.post("/reviews", async (req, res) => {
  const review = req.body;

  const alreadyReviewed = await reviewsCollection.findOne({
    applicationId: review.applicationId,
    studentEmail: review.studentEmail,
  });

  if (alreadyReviewed) {
    return res.status(400).send({ message: "Already reviewed" });
  }

  const result = await reviewsCollection.insertOne(review);
  res.send(result);
});
//get review
app.get("/reviews", async (req, res) => {
  const reviews = await reviewsCollection.find({}).toArray();
  res.send(reviews);
});
//get single reviews by email
app.get('/my-reviews/:email',async(req,res)=>{
const email = req.params.email;
const result = await reviewsCollection.find({ studentEmail: email }).toArray();
  res.send(result)
})
//delete review
app.delete("/reviews/:id", async (req, res) => {
  const { id } = req.params;
    const result = await reviewsCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount > 0) {
      return res.send({ success: true, message: "Review deleted successfully" });
    } else {
      return res.status(404).send({ success: false, message: "Review not found" });
    }
  
});
// Delete a review by ID, only if it belongs to the user
app.delete("/my-reviews/:id/:email", async (req, res) => {
  const { id, email } = req.params;
const result = await reviewsCollection.deleteOne({
  _id: new ObjectId(id),
  studentEmail: email,
});


    if (result.deletedCount > 0) {
      return res.send({ success: true, message: "Review deleted successfully" });
    } else {
      return res.status(404).send({ success: false, message: "Review not found or not yours" });
    }
  
});
//edit review
// Update review by ID
app.patch('/reviews/:id', async (req, res) => {
  const id = req.params.id;
  const { rating, comment } = req.body;
    const result = await reviewsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { rating, comment } }
    );
    if (result.modifiedCount > 0) {
      res.send({ success: true, message: "Review updated" });
    } else {
      res.status(404).send({ success: false, message: "Review not found" });

  } 
});




//get all applys for moderator by email
app.get('/moderator-applications/:email',async(req,res)=>{
const email = req.params.email;
const result = await scholarshipCollection.find({'moderator.email':email}).toArray()
  res.send(result
  )  }
)

app.post('/users',async(req,res)=>{
const userData = req.body;
userData.created_at = new Date().toISOString();
userData.last_loggesIn = new Date().toISOString();
userData.role = 'student';
const query = {email:userData.email}
const alreadyExists = await usersCollection.findOne(query)
console.log('userExists',!!alreadyExists)
if(alreadyExists){
  console.log('updating user info')
  const result = await usersCollection.updateOne(query,{$set:{
    last_loggedIn:new Date().toISOString(),
  },
})
  return res.send(result)
}
console.log('saving new user')
const result = await usersCollection.insertOne(userData)
res.send(result)


})







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