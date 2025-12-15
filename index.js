
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
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).send({ message: 'Unauthorized Access!' });
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).send({ message: 'Unauthorized Access!' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    next();
  } catch (err) {
    console.error(err);
    return res.status(401).send({ message: 'Unauthorized Access!' });
  }
};


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
 //veryfy admin
    const verifyADMIN = async (req, res, next) => {
      const email = req.tokenEmail
      const user = await usersCollection.findOne({ email })
      if (user?.role !== 'Admin')
        return res
          .status(403)
          .send({ message: 'Admin only Actions!', role: user?.role })

      next()
    }
//verify moderator
    const verifyMODERATOR = async (req, res, next) => {
      const email = req.tokenEmail
      const user = await usersCollection.findOne({ email })
      if (user?.role !== 'Moderator')
        return res
          .status(403)
          .send({ message: 'moderator only Actions!', role: user?.role })

      next()
    }
    
 //post scholarship data
  app.post('/scholarships',verifyJWT,verifyADMIN,async(req,res)=>{
    const scholarshipData = req.body;
    const result = await scholarshipCollection.insertOne(scholarshipData)
    res.send(result)
  })
//get all scholarships
app.get('/allscholarships', async (req, res) => {
  try {
    const {
      search = '',
      country = '',
      sortBy = 'fees_asc',
      page = 1,
      limit = 8
    } = req.query;

    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);
    const skip = (pageNumber - 1) * limitNumber;

    /* -------- FILTER -------- */
    const query = {};

    //  Search by Scholarship Name 
    if (search) {
      query.scholarshipName = {
        $regex: search,
        $options: 'i',
      };
    }

    //  Filter by Country
    if (country) {
      query.country = country;
    }

    /* -------- SORT (Application Fees) -------- */
    let sortQuery = {};

    if (sortBy === 'fees_asc') {
      sortQuery.applicationFees = 1;
    }

    if (sortBy === 'fees_desc') {
      sortQuery.applicationFees = -1;
    }

    /* -------- DB QUERY -------- */
    const scholarships = await scholarshipCollection
      .find(query)
      .sort(sortQuery)
      .skip(skip)
      .limit(limitNumber)
      .toArray();

    const total = await scholarshipCollection.countDocuments(query);
    const pages = Math.ceil(total / limitNumber);

    res.send({
      scholarships,
      total,
      pages,
      currentPage: pageNumber,
    });

  } catch (error) {
    res.status(500).send({ message: 'Server Error' });
  }
});

//get all scholarships for admin
app.get('/scholarships',verifyJWT,verifyADMIN,async(req,res)=>{
  const result = await scholarshipCollection.find().toArray()
  res.send(result)
})

//get single scholarship
app.get('/scholarships/:id',async(req,res)=>{
  const id = req.params.id;
    const result = await scholarshipCollection.findOne({_id: new ObjectId(id)})
     res.send(result)
})
//delete single scholarship
app.delete('/scholarships/:id',verifyJWT,verifyADMIN, async (req, res) => {

    const id = req.params.id;
    const result = await scholarshipCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Scholarship not found' });
    }

    res.json({ message: 'Scholarship deleted successfully' });
});
//update/scholarship/id
app.put('/scholarships/:id',verifyJWT,verifyADMIN, async (req, res) => {
  try {
    const id = req.params.id;
    const newData = req.body; // must contain all fields of the scholarship

    // Validate ID
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid scholarship ID' });
    }

    // Replace the entire document
    const result = await scholarshipCollection.replaceOne(
      { _id: new ObjectId(id) },
      newData
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Scholarship not found' });
    }

    res.json({ message: 'Scholarship updated successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to update scholarship' });
  }
});





//get all applys for a student by email
app.get('/my-applications/',verifyJWT,async(req,res)=>{
const result = await applyCollection.find({studentEmail: req.tokenEmail}).toArray()
  res.send(result)
})
//get all applys 
app.get('/applications',verifyJWT,verifyMODERATOR,async(req,res)=>{
const result = await applyCollection.find().toArray()
  res.send(result)

})

// update application status
app.patch('/applications/status/:id',verifyJWT,verifyMODERATOR,async(req,res)=>{
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
app.post("/reviews",verifyJWT, async (req, res) => {
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
app.get("/reviews",verifyJWT,verifyMODERATOR, async (req, res) => {
  const reviews = await reviewsCollection.find({}).toArray();
  res.send(reviews);
});
//get single reviews by email
app.get('/my-reviews/',verifyJWT,async(req,res)=>{
const result = await reviewsCollection.find({ studentEmail: req.tokenEmail }).toArray();
  res.send(result)
})
//delete review
app.delete("/reviews/:id",verifyJWT,verifyMODERATOR, async (req, res) => {
  const { id } = req.params;
    const result = await reviewsCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount > 0) {
      return res.send({ success: true, message: "Review deleted successfully" });
    } else {
      return res.status(404).send({ success: false, message: "Review not found" });
    }
  
});
// Delete a review by ID, only if it belongs to the user
app.delete("/my-reviews/:id/:email",verifyJWT, async (req, res) => {
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
app.patch('/reviews/:id',verifyJWT, async (req, res) => {
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
//save users in database
 app.post('/users', async (req, res) => {
      const userData = req.body
      userData.created_at = new Date().toISOString()
      userData.last_loggedIn = new Date().toISOString()
      userData.role = 'Student'

      const query = {
        email: userData.email,
      }

      const alreadyExists = await usersCollection.findOne(query)
      console.log('User Already Exists---> ', !!alreadyExists)

      if (alreadyExists) {
        console.log('Updating user info......')
        const result = await usersCollection.updateOne(query, {
          $set: {
            last_loggedIn: new Date().toISOString(),
          },
        })
        return res.send(result)
      }

      console.log('Saving new user info......')
      const result = await usersCollection.insertOne(userData)
      res.send(result)
    })

//get all users
app.get('/users',verifyJWT,verifyADMIN, async (req, res) => {
  const users = await usersCollection.find().toArray();
  res.send(users);
});
 // get a user's role 
app.get('/user/role/',verifyJWT, async (req, res) => {
     const result = await usersCollection.findOne({ email: req.tokenEmail })
      res.send({ role: result?.role })
      console.log(result)
 })
// Update role
app.patch('/users/:id/role',verifyJWT,verifyADMIN, async (req, res) => {
  const { role } = req.body;
  const { id } = req.params;
  const result = await usersCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { role } }
  );
  res.send(result);
});

// Delete user
app.delete('/users/:id',verifyJWT,verifyADMIN, async (req, res) => {
  const { id } = req.params;
  const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});

// payment endpoint
 app.post('/create-checkout-session',verifyJWT, async (req, res) => {
      const paymentInfo = req.body;
      console.log('paymentinfo',paymentInfo)
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
          customer: paymentInfo?.Student?.name,
        },
        success_url: `${process.env.CLIENT_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_DOMAIN}/dashboard`,
      })
      res.send({ url: session.url })
    })
//get payment data
app.post('/payment-success',verifyJWT, async (req, res) => {
      const { sessionId } = req.body
      const session = await stripe.checkout.sessions.retrieve(sessionId)
      
      console.log('payment-session',session)
      const  scholarship = await scholarshipCollection.findOne({_id:
         new ObjectId(session.metadata.scholarshipId)})
         console.log('scholarship',scholarship)
      const apply = await applyCollection.findOne({
        tranjectionId: session.payment_intent,
      })
      if (session.status === 'complete' && scholarship && !apply) {
        const applyInfo = {
          scholarshipId: session.metadata.scholarshipId,
          tranjectionId: session.payment_intent,
          student : session.metadata.customer,
          studentName : session.metadata.customer,
          studentEmail : session.customer_email,
          moderator:session.moderator,
          status: 'pending',
          scholarshipName: scholarship.scholarshipName,
          universityName: scholarship.universityName,
          applicationFees: scholarship.applicationFees,
          country: scholarship.country,
          city: scholarship.city,
          degree: scholarship.degree,
          subjectCategory: scholarship.subjectCategory,
          paymentStatus: session. payment_status,
          amount: session.amount_total / 100,
        }
          const result = await applyCollection.insertOne(applyInfo)
      }
      res.send(scholarship)

})

//for analytics
//total users
app.get('/analytics/total-users',verifyJWT,verifyADMIN, async (req, res) => {
  const totalUsers = await usersCollection.countDocuments();
  res.send({ totalUsers });
});
//total scholarships
app.get('/analytics/total-scholarships',verifyJWT,verifyADMIN, async (req, res) => {
  const totalScholarships = await scholarshipCollection.countDocuments();
  res.send({ totalScholarships });
});
//total applicatons
app.get('/analytics/total-fees',verifyJWT,verifyADMIN,  async (req, res) => {
  const result = await applyCollection.aggregate([
    { $group: { _id: null, totalFees: { $sum: "$applicationFees" } } }
  ]).toArray();
  res.send({ totalFees: result[0]?.totalFees || 0 });
});
//applications by university
app.get('/analytics/applications-chart',verifyJWT,verifyADMIN,  async (req, res) => {
  const data = await applyCollection.aggregate([
    { $group: { _id: "$universityName", applications: { $sum: 1 } } }
  ]).toArray();
  res.send(data);
});




    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
   
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from Server..')
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
// module.exports = app;