const express = require("express");
const app = express();
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const serviceAccount = require('./key.json');
const session = require("express-session");
const { spawn } = require('child_process');
const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = getFirestore();
const auth = getAuth();

app.set("view engine", "ejs");
app.use(express.static(__dirname + "/views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: "hello",
  resave: false,
  saveUninitialized: true
}));

function isAuthenticated(req, res, next) {
  if (req.session.userdata) {
    return next();
  } else {
    res.redirect("/login");
  }
}

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// ---------- DATA SUBMISSION & MODEL TRAINING ----------
app.post("/datasubmit", isAuthenticated, async (req, res) => {
  const userId = req.session.userdata.id;
  const { em, im, edum, emim, loanm, savem, inm, othm, ltgm, stgm, taxm } = req.body;

  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Get submissions from this user for the current month
    const snapshot = await db.collection("mldata")
      .where("userId", "==", userId)
      .where("timestamp", ">=", startOfMonth)
      .where("timestamp", "<=", endOfMonth)
      .get();

    if (!snapshot.empty) {
      return res.render("model", { errorMessage: "You have already submitted, try submitting next month." });
    }

    await db.collection("mldata").add({
      userId,
      em: parseFloat(em),
      im: parseFloat(im),
      edum: parseFloat(edum),
      emim: parseFloat(emim),
      loanm: parseFloat(loanm),
      savem: parseFloat(savem),
      inm: parseFloat(inm),
      othm: parseFloat(othm),
      ltgm: parseFloat(ltgm),
      stgm: parseFloat(stgm),
      taxm: parseFloat(taxm),
      timestamp: new Date()  // Add timestamp
    });

    const pythonProcess = spawn('python', ['train_model.py']);
    pythonProcess.stdout.on('data', (data) => {
      console.log(`Training Output: ${data}`);
    });
    pythonProcess.stderr.on('data', (data) => {
      console.error(`Training Error: ${data}`);
    });
    pythonProcess.on('close', (code) => {
      console.log(`Training process exited with code ${code}`);
      res.render("model", { successMessage: "Data submitted successfully" });
    });

  } catch (err) {
    console.error("Data submission error:", err);
    res.status(500).send("Error submitting data");
  }
});


// ---------- PREDICTION ----------
app.post("/predictValues", isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.userdata.id;
    const snapshot = await db.collection("mldata").where("userId", "==", userId).get();

    if (snapshot.empty) {
      return res.status(400).json({ error: "No data available for prediction" });
    }

    const latestDoc = snapshot.docs[snapshot.docs.length - 1].data();
    const inputValues = [
      latestDoc.em, latestDoc.im, latestDoc.edum, latestDoc.emim, latestDoc.loanm,
      latestDoc.inm, latestDoc.othm, latestDoc.ltgm, latestDoc.stgm, latestDoc.taxm
    ];

    const pythonProcess = spawn('python', ['predict_model.py', ...inputValues.map(String)]);
    let predictionOutput = "";

    pythonProcess.stdout.on('data', (data) => {
      predictionOutput += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      console.error(`Prediction Error: ${data}`);
    });

    pythonProcess.on('close', (code) => {
      try {
        const predictedValues = JSON.parse(predictionOutput.replace(/'/g, '"').trim());
        res.json({ predictedValues });
      } catch (err) {
        console.error('Prediction Parsing Error:', err);
        res.status(500).json({ error: 'Prediction output parsing failed.' });
      }
    });

  } catch (error) {
    console.error('Prediction request error:', error);
    res.status(500).json({ error: 'Prediction failed.' });
  }
});

// ---------- USER AUTHENTICATION ----------

// ✅ Updated Registration using Firebase Auth
app.post("/registersubmit", (req, res) => {
  const { name, email, password, age, annualIncome, maritalStatus, numChildren } = req.body;

  db.collection("users")
    .where("email", "==", email)
    .get()
    .then((docs) => {
      if (!docs.empty) {
        res.render("registration", { errorMessage: "Email already in use" });
      } else if (password.length < 8) {
        res.render("registration", { errorMessage: "Password must contain at least 8 characters" });
      } else {
        auth.createUser({ email, password })
          .then((userRecord) => {
            const uid = userRecord.uid;
            return db.collection("users").doc(uid).set({
              name,
              email,
              age,
              annualIncome,
              maritalStatus,
              numChildren
            });
          })
          .then(() => res.redirect("/login"))
          .catch((error) => {
            console.error("Error creating user:", error);
            res.render("registration", { errorMessage: error.message });
          });
      }
    });
});

// 🔐 Login logic (basic, still uses Firestore password check — optional to improve)
app.post("/loginsubmit", (req, res) => {
  const idToken = req.body.idToken;

  if (!idToken) {
    return res.redirect("/login"); // or res.status(400).send("No token provided");
  }

  admin
    .auth()
    .verifyIdToken(idToken)
    .then(async (decodedToken) => {
      const uid = decodedToken.uid;

      // Optionally store user info in session
      const userDoc = await db.collection("users").doc(uid).get();
      const userData = userDoc.data();
      req.session.userdata = { id: uid, ...userData };

      res.redirect("/home");
    })
    .catch((error) => {
      console.error("Error verifying token:", error);
      res.redirect("/login"); // Redirect back to login if token invalid
    });
});


// ---------- PAGES ----------
app.get("/login", (req, res) => res.render("login"));
app.get("/registration", (req, res) => res.render("registration"));
app.get("/about", isAuthenticated, (req, res) => res.render("about"));
app.get("/home", isAuthenticated, (req, res) => res.render("home", {
  name1: req.session.userdata.name,
  annualIncome: req.session.userdata.annualIncome
}));
app.get("/contact", isAuthenticated, (req, res) => res.render("contact"));
app.get("/predict", isAuthenticated, (req, res) => res.render("predict"));
app.get("/tax", isAuthenticated, (req, res) => res.render("tax"));
app.get("/finance", isAuthenticated, (req, res) => res.render("finance"));
app.get("/trading", isAuthenticated, (req, res) => res.render("trading"));
app.get("/settings", isAuthenticated, (req, res) => res.render("settings"));
app.get("/mlsub", isAuthenticated, (req, res) => res.render("mlsub"));

app.get("/financedata", isAuthenticated, (req, res) => {
  const userId = req.session.userdata.id;
  db.collection("mldata")
    .where("userId", "==", userId)
    .get()
    .then((snapshot) => {
      const financeData = snapshot.docs.map((doc) => doc.data());
      res.render("financedata", { financeData });
    });
});

app.get("/model", isAuthenticated, (req, res) => {
  const userId = req.session.userdata.id;
  db.collection("mldata")
    .where("userId", "==", userId)
    .get()
    .then((snapshot) => {
      const financeData = snapshot.docs.map((doc) => doc.data());
      res.render("model", { financeData });
    });
});

app.get("/profile", isAuthenticated, (req, res) => {
  const { name, annualIncome, age, maritalStatus, numChildren, email } = req.session.userdata;
  res.render("profile", { username: name, email, age });
});

app.post("/updateUserInfo", isAuthenticated, (req, res) => {
  const { name, email, age } = req.body;
  const userId = req.session.userdata.id;

  // Check if the email already exists in the database (other than the current user's email)
  db.collection("users")
    .where("email", "==", email)
    .get()
    .then((docs) => {
      // If the email exists and the document ID is not the current user's ID
      if (docs.size > 0 && docs.docs[0].id !== userId) {
        // Email exists for another user, show the error message
        return res.render("settings", { errorMessage: "Email already exists" });
      } else {
        // Proceed to update user info if email doesn't exist or it's the user's own email
        db.collection("users")
          .doc(userId)
          .update({
            name: name,
            email: email,
            age: parseInt(age),
          })
          .then(() => {
            // Update session with new user data
            req.session.userdata = { ...req.session.userdata, name, email, age };

            res.redirect("/profile");
          })
          .catch((error) => {
            console.error("Error updating user information: ", error);
            res.status(500).send("Error updating user information.");
          });
      }
    })
    .catch((error) => {
      console.error("Error checking existing email:", error);
      res.status(500).send("Error checking existing email.");
    });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/", (req, res) => {
  res.redirect("/login");
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
