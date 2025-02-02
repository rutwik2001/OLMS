// jshint esversion:6

import express from 'express';
import { MongoClient } from 'mongodb';
import bodyParser from 'body-parser';
import ejs from 'ejs';
import mongoose from 'mongoose';
import fileUpload from 'express-fileupload';
import multer from 'multer';
import fs from 'fs';
import util from 'util';
import bcrypt from 'bcrypt';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import flash from 'express-flash';
import session from 'express-session';
import crypto from 'crypto';
import moment from 'moment';
import { ObjectId } from 'mongodb'; 
import methodOverride from 'method-override';
import {uploadFile, getFileStream} from "./s3.js"
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
dotenv.config();
moment().format();

const upload = multer({ dest: 'uploads/' });
const unlinkFile = util.promisify(fs.unlink);

const app = express();

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/public', express.static('public'));
app.use(flash());
app.use(
  session({
    secret: '123',
    resave: false,
    saveUninitialized: false,
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use(methodOverride('_method'));

mongoose.connect('mongodb+srv://admin:admin@olms.m8fy4.mongodb.net/?retryWrites=true&w=majority&appName=OLMS', {
  useNewUrlParser: true,
});

const client = new MongoClient(
  'mongodb+srv://admin:admin@olms.m8fy4.mongodb.net/?retryWrites=true&w=majority&appName=OLMS'
);

const mainDataDb = client.db('OLMS');
const usersCollection = mainDataDb.collection('users');
const courseCollection = mainDataDb.collection('courses');
const sectionCollection = mainDataDb.collection('sections');
const submissionsCollection = mainDataDb.collection('submissions');

function checkAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).redirect('/login');
}

function checkNotAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return res.redirect('/dashboard');
  }
  next();
}

function checkRole(role) {
  return function (req, res, next) {
    if (req.user && req.user.email.endsWith(role)) {
      next();
    } else {
      res.status(401).redirect('/login');
    }
  };
}

passport.use(
  new LocalStrategy({ usernameField: 'email' }, async function (email, password, done) {
    try {
      const user = await usersCollection.findOne({ email });
      if (!user) {
        return done(null, false, { message: 'No user found with that email' });
      }

      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return done(null, false, { message: 'Incorrect password' });
      }

      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

passport.serializeUser((user, done) => {
  done(null, user.userId);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await usersCollection.findOne({ userId: id });
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

app.get('/signup', checkNotAuthenticated, (req, res) => {
  res.status(200).render('signup');
});

app.post('/signup', checkNotAuthenticated, async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const userCount = await usersCollection.find().toArray();
    await usersCollection.insertOne({
      userId: userCount.length + 1,
      name: req.body.name,
      email: req.body.email,
      password: hashedPassword,
      role: req.body.role,
      mobile: req.body.phone,
      dob: req.body.phone,
      emergencyContacts: {
        name: req.body.emergencyName,
        email: req.body.emergencyEmail,
        mobile: req.body.emergencPhone,
      },
      address: req.body.address,
    });

    res.status(201).redirect('/login');
  } catch (err) {
    console.log(err);
    res.status(500).redirect('/signup');
  }
});

app.get('/login', checkNotAuthenticated, (req, res) => {
  res.status(200).render('login', { message: req.flash('error') });
});

// Updated login POST route
app.post('/login', checkNotAuthenticated, (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      req.flash('error', 'Internal server error. Please try again.');
      return res.status(500).redirect('/login');
    }

    if (!user) {
      req.flash('error', info.message || 'Invalid credentials. Please try again.');
      return res.status(401).redirect('/login');
    }

    req.logIn(user, (loginErr) => {
      if (loginErr) {
        req.flash('error', 'Login failed. Please try again.');
        return res.status(500).redirect('/login');
      }

      res.redirect('/dashboard');
    });
  })(req, res, next);
});

app.delete('/logout', (req, res) => {
  req.logOut((err) => {
    if (err) {
      return next(err);
    }
    req.session.destroy((err) => {
      if (err) {
        return next(err);
      }
      res.clearCookie('connect.sid');
      res.status(200).redirect('/login');
    });
  });
});

app.get('/dashboard', checkAuthenticated, (req, res) => {
  console.log(req.user.userId)
  if (req.user.email.endsWith('@mavs.uta.edu')) {
    return res.status(200).redirect('/student/dashboard');
  } else if (req.user.email.endsWith('@uta.edu')) {
    return res.status(200).redirect('/instructor/dashboard');
  }
});

app.get('/student/dashboard', checkAuthenticated, checkRole('@mavs.uta.edu'), async (req, res) => {
  console.log(req.user.userId)
  try {
    const sections = await sectionCollection.find({"students.studentId": req.user.userId}).toArray();
    res.status(200).render('studentDashboard', { user: req.user, sections: sections });
  } catch (error) {
    console.log(err);
    // res.status(500).redirect('/instructor/dashboard');
  }
});

app.get('/instructor/dashboard', checkAuthenticated, checkRole('@uta.edu'), async (req, res) => {
  try {
    const sections = await sectionCollection.find({ teacherId: req.user.userId }).toArray();
    res.status(200).render('instructorDashboard', { user: req.user, sections: sections });
  } catch (error) {
    console.error("Error loading instructor dashboard:", error);
    res.status(500).render('instructorDashboard', { user: req.user, sections: [], error: "Failed to load sections. Please try again later." });
  }
});


app.get('/profile/instructor/:userId', checkAuthenticated, async (req, res) => {
  const { userId } = req.params;
  
  try {
    const instructorProfile = await mainDataDb.collection('instructors').findOne({ userId: parseInt(userId) });
    const user = await usersCollection.findOne({ userId: parseInt(userId) });
    if (instructorProfile) {
      res.status(200).render('viewInstructorProfile', { user: req.user, searchedUser: user, profile: instructorProfile });
    } else {
      res.status(404).send('Instructor profile not found.');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Error retrieving instructor profile.');
  }
});

app.get('/instructor/profile', checkAuthenticated, checkRole('@uta.edu'), async (req, res) => {
  try {
    const instructorProfile = await mainDataDb.collection('instructors').findOne({ userId: req.user.userId });
    console.log(req.user)
    res.render('instructorProfileForm', { user: req.user, profile: instructorProfile || {}, success: null, error: null });
  } catch (err) {
    console.error(err);
    res.status(500).render('instructorProfileForm', { user: req.user, profile: {}, success: null, error: 'Error loading profile.' });
  }
});

app.post('/instructor/profile', checkAuthenticated, checkRole('@uta.edu'), async (req, res) => {
  const { department, specializations, publications, education, researchInterests } = req.body;

  // Validate department input to only contain letters
  if (!/^[A-Za-z\s]+$/.test(department)) {
    return res.status(400).render('instructorProfileForm', { user: req.user, profile: {}, error: 'Invalid department. Only letters and spaces are allowed.' });
  }

  try {
    await mainDataDb.collection('instructors').updateOne(
      { userId: req.user.userId },
      {
        $set: {
          department,
          specializations: specializations,
          publications: publications,
          education,
          researchInterests: researchInterests,
        },
      },
      { upsert: true }
    );

    res.render('instructorProfileForm', {
      user: req.user,
      profile: { department, specializations, publications, education, researchInterests },
      success: 'Profile updated successfully!',
      error: null
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('instructorProfileForm', {
      user: req.user,
      profile: { department, specializations, publications, education, researchInterests },
      success: null,
      error: 'Error updating profile. Please try again.'
    });
  }
});




app.get('/student/dashboard', checkAuthenticated, checkRole('@uta.edu'), async (req, res) => {
  console.log('Student');
  console.log(req.user.userId)
  try {
    const sections = await sectionCollection.find({"students.studentId": req.user.userId}).toArray();
    res.status(200).render('studentDashboard', { user: req.user, sections: sections });
  } catch (error) {
    console.log(err);
    // res.status(500).redirect('/instructor/dashboard');
  }
  
});

app.get('/instructor/add-course', checkAuthenticated, checkRole('@uta.edu'), async (req, res) => {
  const courses = await courseCollection.find({ instructorId: req.user.userId }).toArray();
  res.status(200).render('instructorAddCourse', { user: req.user, courses: courses, error: null });
});

app.post('/instructor/add-course', checkAuthenticated, checkRole('@uta.edu'), async (req, res) => {
  const { courseId, courseName, sectionId, term, year, classroom, startTime, endTime, days, assignmentWeight, examWeight, presentationWeight, credits } = req.body;

  try {
    // Check if course already exists
    const existingCourse = await courseCollection.findOne({ courseId, instructorId: req.user.userId });
    
    if (existingCourse) {
      const courses = await courseCollection.find({ instructorId: req.user.userId }).toArray();
      return res.status(400).render('instructorAddCourse', { user: req.user, courses, error: "Course already exists." });
    }

    // Insert the new course
    await courseCollection.insertOne({
      courseId,
      name: courseName,
      instructorId: req.user.userId,
      credits: parseFloat(credits),
      weightages: {
        assignment: parseFloat(assignmentWeight),
        exam: parseFloat(examWeight),
        presentation: parseFloat(presentationWeight),
      },
    });

    // Check for overlapping sections and prepare sections to insert
    const sectionsToInsert = [];
    for (let i = 0; i < sectionId.length; i++) {
      const sectionStartMinutes = timeToMinutes(startTime[i]);
      const sectionEndMinutes = timeToMinutes(endTime[i]);

      // Check for overlapping sections
      const overlappingSection = await sectionCollection.findOne({
        teacherId: req.user.userId,
        term: term[i],
        year: parseInt(year[i]),
        days: { $in: days[i] ? days[i] : [] }, // Check if days overlap
        $or: [
          { startMinutes: { $gt: sectionStartMinutes, $lt: sectionEndMinutes }, endMinutes: { $gt: sectionStartMinutes, $lt: sectionEndMinutes } } // Time overlap check
        ]
      });

      if (overlappingSection) {
        const courses = await courseCollection.find({ instructorId: req.user.userId }).toArray();
        return res.status(400).render('instructorAddCourse', {
          user: req.user,
          courses,
          error: `Section ${sectionId[i]} has overlapping days and times with an existing section. Please adjust the schedule.`
        });
      }

      // Add section if no overlap
      sectionsToInsert.push({
        sectionId: courseId + "-" + sectionId[i],
        courseId: courseId,
        teacherId: req.user.userId,
        term: term[i],
        year: parseInt(year[i]),
        classroom: classroom[i],
        startTime: startTime[i],
        endTime: endTime[i],
        startMinutes: sectionStartMinutes,
        endMinutes: sectionEndMinutes,
        days: days[i] ? days[i] : [],
        students: [],
        completed: false,
      });
    }

    // Insert all sections if no conflicts are found
    await sectionCollection.insertMany(sectionsToInsert);
    res.status(201).redirect('/instructor/dashboard');
  } catch (err) {
    console.log(err);
    res.status(500).render('instructorAddCourse', { user: req.user, error: "Failed to add course. Please try again." });
  }
});

// Route to manage sections of an existing course
app.get('/instructor/:courseId/manage-sections', checkAuthenticated, checkRole('@uta.edu'), async (req, res) => {
  const { courseId } = req.params;

  try {
    const course = await courseCollection.findOne({ courseId, instructorId: req.user.userId });
    if (!course) {
      return res.status(404).render('instructorDashboard', { user: req.user, error: 'Course not found.' });
    }

    const sections = await sectionCollection.find({ courseId }).toArray();
    res.render('manageSections', { user: req.user, course, sections, error: null });
  } catch (err) {
    console.error(err);
    res.status(500).render('instructorDashboard', { user: req.user, error: 'Error loading sections.' });
  }
});

function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}
app.post('/instructor/:courseId/add-section', checkAuthenticated, checkRole('@uta.edu'), async (req, res) => {
  const { courseId } = req.params;
  const { sectionId, term, year, classroom, startTime, endTime, days } = req.body;

  try {
    // Convert times to minutes from midnight for accurate comparison
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);

  
    // Step 2: Check for day and time overlap with the new `startMinutes` and `endMinutes`
    const dayTimeConflict = await sectionCollection.findOne({
      teacherId: req.user.userId,
      term: term,
      year: parseInt(year),
      days: { $in: days }, // Check for any overlapping days
      $or: [
        { startMinutes: { $gt: startMinutes, $lt: endMinutes }, endMinutes: { $gt: startMinutes, $lt: endMinutes } } // Overlap in time ranges
      ],
    });

    if (dayTimeConflict) {
      return res.status(400).render('manageSections', {
        user: req.user,
        course: await courseCollection.findOne({ courseId }),
        sections: await sectionCollection.find({ courseId }).toArray(),
        error: 'Section days and times overlap with another section you are teaching. Please adjust the schedule.',
      });
    }

    // Insert new section if no conflicts
    await sectionCollection.insertOne({
      sectionId,
      courseId,
      teacherId: req.user.userId,
      term,
      year: parseInt(year),
      classroom,
      startTime,
      endTime,
      startMinutes,
      endMinutes,
      days,
      students: [],
      completed: false,
    });

    res.redirect(`/instructor/${courseId}/manage-sections`);
  } catch (err) {
    console.error('Error adding section:', err);
    res.status(500).render('manageSections', {
      user: req.user,
      error: 'Error adding section. Please try again.',
      course: await courseCollection.findOne({ courseId }),
      sections: await sectionCollection.find({ courseId }).toArray(),
    });
  }
});





app.delete('/instructor/:courseId/delete-section/:sectionId', checkAuthenticated, checkRole('@uta.edu'), async (req, res) => {
  const { courseId, sectionId } = req.params;

  try {
    await sectionCollection.deleteOne({ sectionId, courseId });
    res.status(200).json({ message: 'Section deleted successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error deleting section.' });
  }
});


app.get('/instructor/courses', checkAuthenticated, checkRole('@uta.edu'), async (req, res) => {
  try {
    // Fetch courses the instructor is teaching
    const courses = await courseCollection.find({ instructorId: req.user.userId }).toArray();
    res.status(200).render('instructorCourses', { user: req.user, courses });
  } catch (error) {
    console.error(error);
    res.status(500).render('error', { user: req.user, message: 'Error loading dashboard.' });
  }
});




app.get('/instructor/:courseId/add-edit-syllabus', checkAuthenticated, checkRole('@uta.edu'), (req, res) => {
  console.log('Instructor');
  const { courseId } = req.params;
  res.status(200).render('instructorAddSyllabus', { user: req.user, courseId:courseId });
});

app.post('/instructor/:courseId/add-edit-syllabus', checkAuthenticated, checkRole('@uta.edu'), upload.single('syllabusFile'), async (req, res) => {
  const { courseId } = req.params;

  try {
    // Upload file to S3
    const result = await uploadFile(req.file); // Upload the file
    const fileUrl = result.Location; // Get the URL of the uploaded file

    // Update the course document with S3 file URL, filename, and MIME type
    await courseCollection.updateOne(
      { courseId: courseId },
      { $set: { syllabusLink: fileUrl, filename: req.file.originalname, mimeType: req.file.mimetype } },
      { upsert: true }
    );
    
    res.redirect(`/instructor/dashboard`); // Redirect to instructor dashboard
  } catch (error) {
    console.error('Error uploading file to S3:', error);
    res.status(500).send('Error uploading syllabus file');
  }
});


app.get('/instructor/:courseId/:sectionId/add-modules', checkAuthenticated, checkRole('@uta.edu'), (req, res) => {
  console.log('Instructor');
  const { courseId, sectionId } = req.params;
  res.status(200).render('instructorAddModules', { user: req.user, courseId:courseId, sectionId: sectionId });
});

app.post('/instructor/:courseId/:sectionId/add-modules', checkAuthenticated, checkRole('@uta.edu'), upload.single('moduleFile'), async (req, res) => {
  const { courseId, sectionId } = req.params;
  const { name } = req.body;
  try {
    // Upload file to S3
    const result = await uploadFile(req.file); // Upload the file
    const fileUrl = result.Location; // Get the URL of the uploaded file

    // Here, you would update the course document in the database with the S3 file URL
    await sectionCollection.updateOne(
      { courseId: courseId, sectionId: sectionId },
      { $push: { modules: { name: name, link: fileUrl, filename: req.file.originalname, mimeType: req.file.mimetype } } }
    );

    res.redirect(`/section/${courseId}/${sectionId}/modules`);
  } catch (error) {
    console.error('Error uploading file to S3:', error);
    res.status(500).send('Error uploading syllabus file');
  }
});



app.get('/instructor/:courseId/:sectionId/add-assignments', checkAuthenticated, checkRole('@uta.edu'), (req, res) => {
  console.log('Instructor');
  const { courseId, sectionId } = req.params;
  res.status(200).render('instructorAddAssignments', { user: req.user, courseId:courseId, sectionId: sectionId });
});

app.post('/instructor/:courseId/:sectionId/add-assignments', checkAuthenticated, checkRole('@uta.edu'), upload.single('moduleFile'), async (req, res) => {
  const { courseId, sectionId } = req.params;
  const { title, description, dueDate, dueTime } = req.body;
  try {
    // Combine date and time fields and convert to Unix timestamp
    const dueDateTime = new Date(`${dueDate}T${dueTime}:00`).getTime() / 1000; // Convert to Unix timestamp

    // Upload file to S3
    const result = await uploadFile(req.file); // Upload the file
    const fileUrl = result.Location; // Get the URL of the uploaded file

    // Update the course document in the database with the S3 file URL and due date
    await sectionCollection.updateOne(
      { courseId: courseId, sectionId: sectionId },
      {
        $push: {
          assignments: {
            title: title,
            description: description,
            link: fileUrl,
            filename: req.file.originalname,
            mimeType: req.file.mimetype,
            dueDateUnix: dueDateTime // Save due date as Unix timestamp
          }
        }
      }
    );

    res.redirect(`/section/${courseId}/${sectionId}/assignments`);
  } catch (error) {
    console.error('Error uploading file to S3:', error);
    res.status(500).send('Error uploading assignment file');
  }
});




app.get('/instructor/:courseId/:sectionId/add-videos', checkAuthenticated, checkRole('@uta.edu'), (req, res) => {
  console.log('Instructor');
  const { courseId, sectionId } = req.params;
  res.status(200).render('instructorAddVideos', { user: req.user, courseId:courseId, sectionId: sectionId });
});

app.post('/instructor/:courseId/:sectionId/add-videos', checkAuthenticated, checkRole('@uta.edu'), upload.single('moduleFile'), async (req, res) => {
  const { courseId, sectionId } = req.params;
  const { title } = req.body;
  try {
    // Upload file to S3
    const result = await uploadFile(req.file); // Upload the file
    const fileUrl = result.Location; // Get the URL of the uploaded file

    // Here, you would update the course document in the database with the S3 file URL
    await sectionCollection.updateOne(
      { courseId: courseId, sectionId: sectionId },
      { $push: { videos: { title: title, link: fileUrl } } }
    );

    res.redirect(`/section/${courseId}/${sectionId}/videos`);
  } catch (error) {
    console.error('Error uploading file to S3:', error);
    res.status(500).send('Error uploading syllabus file');
  }
});

app.get('/instructor/:courseId/:sectionId/add-announcements', checkAuthenticated, checkRole('@uta.edu'), (req, res) => {
  console.log('Instructor');
  const { courseId, sectionId } = req.params;
  res.status(200).render('instructorAddAnnouncements', { user: req.user, courseId:courseId, sectionId: sectionId });
});

app.post('/instructor/:courseId/:sectionId/add-announcements', checkAuthenticated, checkRole('@uta.edu'), async (req, res) => {
  const { courseId, sectionId } = req.params;
  const { title, description } = req.body;

  try {
    // Add announcement to the specified section
    await sectionCollection.updateOne(
      { courseId: courseId, sectionId: sectionId },
      { $push: { announcements: { title: title, description: description } } }
    );

    req.flash('success', 'Announcement added successfully!');
    res.redirect(`/section/${courseId}/${sectionId}/announcements`);
  } catch (error) {
    console.error('Error adding announcement:', error);
    req.flash('error', 'Failed to add announcement. Please try again.');
    res.redirect(`/instructor/${courseId}/${sectionId}/add-announcements`);
  }
});







app.get('/instructor/:courseId/:sectionId/add-exam', checkAuthenticated, checkRole('@uta.edu'), async (req, res) => {
  const { courseId, sectionId } = req.params;
  const course = await courseCollection.findOne({courseId: courseId})
  const section = await sectionCollection.findOne({ sectionId:sectionId, courseId: courseId });
  res.status(200).render('addExam', { user: req.user, course:course, section:section });
});

app.post('/instructor/:courseId/:sectionId/add-exam', checkAuthenticated, checkRole('@uta.edu'), async (req, res) => {
  const { courseId, sectionId } = req.params;
  const { title, grade } = req.body; // `grade` will now be an object with index keys
  try {
    // Find students in the specified section
    const section = await sectionCollection.findOne({ courseId, sectionId }, { projection: { students: 1 } });
    
    if (section && section.students.length > 0) {
      await Promise.all(section.students.map((student, index) => {
        const studentGrade = parseInt(grade[index], 10); // Access grade by index

        return submissionsCollection.updateOne(
          { courseId, sectionId, studentId: student.studentId, assignmentTitle: title, type: "exam", studentName: student.name },
          { $set: { marks: studentGrade } },
          { upsert: true } // Corrected position of upsert option
        );
        
      }));
    }

    res.redirect(`/section/${courseId}/${sectionId}`);
  } catch (error) {
    console.error('Error adding exam:', error);
    res.status(500).send('Error adding exam');
  }
});

app.get('/instructor/:courseId/:sectionId/add-presentation', checkAuthenticated, checkRole('@uta.edu'), async (req, res) => {
  const { courseId, sectionId } = req.params;
  console.log(courseId, sectionId)
  const course = await courseCollection.findOne({courseId: courseId})
  const section = await sectionCollection.findOne({ sectionId:sectionId, courseId: courseId });
  
  res.status(200).render('addPresentation', { user: req.user, course:course, section:section });
});

app.post('/instructor/:courseId/:sectionId/add-presentation', checkAuthenticated, checkRole('@uta.edu'), async (req, res) => {
  const { courseId, sectionId } = req.params;
  const { title, grade } = req.body; // `grade` will now be an object with index keys
  try {
    // Find students in the specified section
    const section = await sectionCollection.findOne({ courseId, sectionId }, { projection: { students: 1 } });
    
    if (section && section.students.length > 0) {
      await Promise.all(section.students.map((student, index) => {
        const studentGrade = parseInt(grade[index], 10); // Access grade by index

        return submissionsCollection.updateOne(
          { courseId, sectionId, studentId: student.studentId, assignmentTitle: title, type: "presentation", studentName: student.name },
          { $set: { marks: studentGrade } },
          { upsert: true } // Corrected position of upsert option
        );
      }));
    }

    res.redirect(`/section/${courseId}/${sectionId}`);
  } catch (error) {
    console.error('Error adding exam:', error);
    res.status(500).send('Error adding exam');
  }
});




app.get('/instructor/section/:courseId/:sectionId/assignemnt/:title/submissions', checkAuthenticated, checkRole('@uta.edu'), async (req, res) => {
  const { sectionId,courseId, title } = req.params;
  const userId = req.user.userId;

  try {
    var submissions = await submissionsCollection.find(
      { courseId: courseId, sectionId: sectionId, assignmentTitle: title },
    ).toArray();
    var section = await sectionCollection.findOne({courseId: courseId, sectionId: sectionId})
    const result = await sectionCollection.findOne(
      { "assignments.title": title },
      { projection: { "assignments.$": 1 } } // This limits the result to matching assignment
    );
    // const section = await sectionCollection.findOne({ sectionId:sectionId, courseId: courseId });
    res.status(200).render('submissions', { user: req.user, submissions: submissions, courseId:courseId, sectionId:sectionId, title:title, dueDate: result.assignments[0].dueDateUnix, section:section });
  } catch (err) {
    console.error(err);
    res.status(500).redirect('/student/dashboard');
  }
});


app.post('/instructor/section/:courseId/:sectionId/assignment/:title/submission/:submissionId/grade', checkAuthenticated, checkRole('@uta.edu'), async (req, res) => {
  const { courseId, sectionId, title, submissionId } = req.params;
  const { grade } = req.body;

  try {
    // Update the submission with the new grade
    
    await submissionsCollection.updateOne(
      { _id: new ObjectId(submissionId) },
      { $set: { marks: parseInt(grade) } }
    );
    res.redirect(`/instructor/section/${courseId}/${sectionId}/assignemnt/${title}/submissions`);
  } catch (err) {
    console.error(err);
    res.status(500).send("An error occurred while updating the grade.");
  }
});

app.get('/instructor/:courseId/:sectionId/submit-final-grades', checkAuthenticated, checkRole('@uta.edu'), async (req, res) => {
  const { courseId, sectionId } = req.params;

  try {
    // Fetch course and section details
    const course = await courseCollection.findOne({ courseId });
    const section = await sectionCollection.findOne({ courseId, sectionId });
    const students = section ? section.students : [];

    if (students.length === 0) {
      return res.status(404).send('No students found in this section.');
    }

    // Create academic report for each student
    await Promise.all(students.map(async student => {
      const studentId = student.studentId;

      // Fetch submissions for the student
      const submissions = await submissionsCollection.find({ 
        courseId, sectionId, studentId 
      }).toArray();

      // Calculate the weighted grade
      let totalGrade = 0;
      let assignmentGrade = 0;
      let examGrade = 0;
      let presentationGrade = 0;
      let assignmentCount = 0;
      let examCount = 0;
      let presentationCount = 0;

      submissions.forEach(submission => {
        if (submission.type === 'assignment') {
          assignmentGrade += submission.marks || 0;
          assignmentCount++;
        } else if (submission.type === 'exam') {
          examGrade += submission.marks || 0;
          examCount++;
        } else if (submission.type === 'presentation') {
          presentationGrade += submission.marks || 0;
          presentationCount++;
        }
      });

      // Calculate average marks per type if there are any submissions
      assignmentGrade = assignmentCount ? (assignmentGrade / assignmentCount) * course.weightages.assignment/100 : 0;
      examGrade = examCount ? (examGrade / examCount) * course.weightages.exam/100 : 0;
      presentationGrade = presentationCount ? (presentationGrade / presentationCount) * course.weightages.presentation/100 : 0;

      // Calculate the final weighted grade
      totalGrade = assignmentGrade + examGrade + presentationGrade;

      // Store the academic report in the `academicReports` collection
      await mainDataDb.collection('academicReports').insertOne({
        studentId,
        courseId,
        sectionId,
        totalGrade: totalGrade.toFixed(2), // Round to 2 decimal places
        semester: section.term,
        year: section.year,
        credits: course.credits,
      });
    }));

    // Mark section as completed
    await sectionCollection.updateOne(
      { courseId, sectionId },
      { $set: { completed: true } }
    );

    res.redirect(`/section/${courseId}/${sectionId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error submitting final grades');
  }
});




// For every role ---------------------------------------------------------------------------------

app.get('/section/:courseId/:sectionId', checkAuthenticated, async (req, res) => {
  const { sectionId,courseId } = req.params;
  const userId = req.user.userId;

  try {
    const course = await courseCollection.findOne({courseId: courseId})
    const section = await sectionCollection.findOne({ sectionId:sectionId, courseId: courseId });
    res.status(200).render('courseDashBoard', { user: req.user, course:course, section:section });
  } catch (err) {
    console.error(err);
    res.status(500).redirect('/student/dashboard');
  }
});

app.get('/download-syllabus/:fileKey', checkAuthenticated, async (req, res) => {
  const { fileKey } = req.params;

  try {
    // Fetch file metadata from the database (filename and MIME type)
    const course = await courseCollection.findOne({ syllabusLink: { $regex: fileKey } });
    if (!course) return res.status(404).send('File not found');

    const { filename, mimeType } = course; // Get the stored filename and MIME type

    // Get the file stream from S3
    const fileStream = getFileStream(fileKey);

    // Set headers to ensure correct file download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', mimeType || 'application/octet-stream'); // Default to binary if MIME type is missing

    // Pipe the file stream to the response
    fileStream.pipe(res).on('error', (error) => {
      console.error('Error downloading the file:', error);
      res.status(500).send('Error downloading the file');
    });
  } catch (error) {
    console.error('Error fetching file from S3:', error);
    res.status(500).send('Error downloading syllabus');
  }
});


app.get('/module/:fileKey', checkAuthenticated, async (req, res) => {
  const { fileKey } = req.params;
  const { filename, mimeType } = req.query;

  try {
    const fileStream = getFileStream(fileKey);

    // Set headers to ensure correct file download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', mimeType || 'application/octet-stream'); // Default to binary if MIME type is missing

    // Pipe the file stream to the response
    fileStream.pipe(res).on('error', (error) => {
      console.error('Error downloading the file:', error);
      res.status(500).send('Error downloading the file');
    });
  } catch (error) {
    console.error('Error fetching file from S3:', error);
    res.status(500).send('Error downloading syllabus');
  }
});


app.get('/assignment/:fileKey', checkAuthenticated, async (req, res) => {
  const { fileKey } = req.params;
  const { filename, mimeType } = req.query;

  try {
    const fileStream = getFileStream(fileKey);

    // Set headers to ensure correct file download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', mimeType || 'application/octet-stream'); // Default to binary if MIME type is missing

    // Pipe the file stream to the response
    fileStream.pipe(res).on('error', (error) => {
      console.error('Error downloading the file:', error);
      res.status(500).send('Error downloading the file');
    });
  } catch (error) {
    console.error('Error fetching file from S3:', error);
    res.status(500).send('Error downloading syllabus');
  }
});


app.get('/submission/:fileKey', checkAuthenticated, async (req, res) => {
  const { fileKey } = req.params;
  const { filename, mimeType } = req.query;

  try {
    const fileStream = getFileStream(fileKey);

    // Set headers to ensure correct file download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', mimeType || 'application/octet-stream'); // Default to binary if MIME type is missing

    // Pipe the file stream to the response
    fileStream.pipe(res).on('error', (error) => {
      console.error('Error downloading the file:', error);
      res.status(500).send('Error downloading the file');
    });
  } catch (error) {
    console.error('Error fetching file from S3:', error);
    res.status(500).send('Error downloading syllabus');
  }
});

app.get('/section/:courseId/:sectionId/people', checkAuthenticated, async (req, res) => {
  const { sectionId,courseId } = req.params;
  const userId = req.user.userId;

  try {
    const course = await courseCollection.findOne({courseId: courseId})
    const section = await sectionCollection.findOne({ sectionId:sectionId, courseId: courseId });
    res.status(200).render('people', { user: req.user, course:course, section:section });
  } catch (err) {
    console.error(err);
    res.status(500).redirect('/student/dashboard');
  }
});

const transporter = nodemailer.createTransport({
  service: 'Gmail', // or your preferred email service
  auth: {
    user: process.env.EMAIL,
    pass: process.env.PASS
  }
});

app.get('/forgot', checkNotAuthenticated, async (req, res) => {

  try {
    
    res.status(200).render('forgotPassword');
  } catch (err) {
    console.error(err);
    res.status(500).redirect('/login');
  }
});

app.post('/forgot', checkNotAuthenticated,async (req, res) => {
  const { email } = req.body;

  try {
    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.status(404).send("No account with that email found.");
    }

    // Generate a token
    const token = crypto.randomBytes(20).toString('hex');
    const expirationTime = Date.now() + 3600000; // 1-hour expiration

    // Save token and expiry to the user's record in the database
    await usersCollection.updateOne(
      { email },
      { $set: { resetPasswordToken: token, resetPasswordExpires: expirationTime } }
    );

    // Send email with reset link
    const resetURL = `http://localhost:3000/reset/${token}`;
    await transporter.sendMail({
      to: user.email,
      from: 'your-email@gmail.com',
      subject: 'Password Reset',
      text: `You are receiving this because you (or someone else) requested a password reset. Please click on the link below or paste it into your browser to complete the process:\n\n${resetURL}`
    });

    res.send('An email has been sent with further instructions.');
    
  } catch (err) {
    console.error(err);
    res.status(500).send("Error on forgot password request.");
  }
});


app.get('/reset/:token', checkNotAuthenticated,async (req, res) => {
  const { token } = req.params;

  try {
    const user = await usersCollection.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() } // Check token expiration
    });

    if (!user) {
      return res.status(400).send("Password reset token is invalid or has expired.");
    }

    res.render('resetPassword', { token }); // Pass token to EJS view
  } catch (err) {
    console.error(err);
    res.status(500).send("Error verifying reset token.");
  }
});

app.post('/reset/:token', checkNotAuthenticated, async (req, res) => {
  const { token } = req.params;
  const { password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return res.status(400).send("Passwords do not match.");
  }

  try {
    const user = await usersCollection.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).send("Password reset token is invalid or has expired.");
    }

    // Hash the new password and update the user's password
    const hashedPassword = await bcrypt.hash(password, 10);
    await usersCollection.updateOne(
      { email: user.email },
      {
        $set: { password: hashedPassword },
        $unset: { resetPasswordToken: "", resetPasswordExpires: "" }
      }
    );

    res.redirect("/login")
  } catch (err) {
    console.error(err);
    res.status(500).send("Error resetting password.");
  }
});


app.get('/section/:courseId/:sectionId/select-student', checkAuthenticated, async (req, res) => {
  const { sectionId,courseId } = req.params;
  const userId = req.user.userId;

  try {
    const course = await courseCollection.findOne({courseId: courseId})
    const section = await sectionCollection.findOne({ sectionId:sectionId, courseId: courseId });
    res.status(200).render('SelectStudentGrade', { user: req.user, course:course, section:section });
  } catch (err) {
    console.error(err);
    res.status(500).redirect('/student/dashboard');
  }
});


app.get('/section/:courseId/:sectionId/grades/:userId', checkAuthenticated, async (req, res) => {
  const { sectionId, courseId, userId } = req.params;

  try {
    const course = await courseCollection.findOne({courseId: courseId})
    const submissions = await submissionsCollection.find(
      { courseId: courseId, sectionId: sectionId, studentId: Number(userId) }
    ).toArray();
    // Calculate the total weighted grade
    let totalGrade = 0;
    let assignmentGrade = 0;
    let examGrade = 0;
    let presentationGrade = 0;
    let assignmentCount = 0;
    let examCount = 0;
    let presentationCount = 0;

    submissions.forEach(submission => {
      if (submission.type === 'assignment') {
        assignmentGrade += submission.marks || 0;
        assignmentCount++;
      } else if (submission.type === 'exam') {
        examGrade += submission.marks || 0;
        examCount++;
      } else if (submission.type === 'presentation') {
        presentationGrade += submission.marks || 0;
        presentationCount++;
      }
    });

    // Calculate average marks per type if there are any submissions
    assignmentGrade = assignmentCount ? (assignmentGrade / assignmentCount) * course.weightages.assignment/100 : 0;
    examGrade = examCount ? (examGrade / examCount) * course.weightages.exam/100 : 0;
    presentationGrade = presentationCount ? (presentationGrade / presentationCount) * course.weightages.presentation/100 : 0;

    // Calculate total weighted grade
    totalGrade = assignmentGrade + examGrade + presentationGrade;

    res.status(200).render('grades', {
      user: req.user,
      submissions,
      sectionId, 
      courseId,
      totalGrade: totalGrade.toFixed(2), // Round to 2 decimal places for clarity
    });
  } catch (err) {
    console.error(err);
    res.status(500).redirect('/instructor/dashboard');
  }
});



app.get('/section/:courseId/:sectionId/modules', checkAuthenticated, async (req, res) => {
  const { sectionId,courseId } = req.params;
  const userId = req.user.userId;

  try {
    const course = await courseCollection.findOne({courseId: courseId})
    const section = await sectionCollection.findOne({ sectionId:sectionId, courseId: courseId });
    // const section = await sectionCollection.findOne({ sectionId:sectionId, courseId: courseId });
    res.status(200).render('modules', { user: req.user, course:course, section:section });
  } catch (err) {
    console.error(err);
    res.status(500).redirect('/student/dashboard');
  }
});


app.get('/section/:courseId/:sectionId/videos', checkAuthenticated, async (req, res) => {
  const { sectionId,courseId } = req.params;
  const userId = req.user.userId;

  try {
    const course = await courseCollection.findOne({courseId: courseId})
    const section = await sectionCollection.findOne({ sectionId:sectionId, courseId: courseId });
    // const section = await sectionCollection.findOne({ sectionId:sectionId, courseId: courseId });
    res.status(200).render('videos', { user: req.user, course:course, section:section });
  } catch (err) {
    console.error(err);
    res.status(500).redirect('/student/dashboard');
  }
});




app.get('/video/:fileKey', checkAuthenticated, async (req, res) => {
  const { fileKey } = req.params;

  // Get the file stream from S3
  const fileStream = getFileStream(fileKey);

  fileStream.pipe(res)
});


app.get('/section/:courseId/:sectionId/video/:title', checkAuthenticated, async (req, res) => {
  const { sectionId,courseId, title } = req.params;
  const userId = req.user.userId;

  try {
    const course = await courseCollection.findOne({courseId: courseId})
    const section = await sectionCollection.findOne({ sectionId:sectionId, courseId: courseId });
    var video = null;
    for(var i=0; i<section.videos.length; i++){
      if(section.videos[i].title == title){
        video = section.videos[i]
      }
    }
    // const ection = await sectionCollection.findOne({ sectionId:sectionId, courseId: courseId });
    res.status(200).render('video', { user: req.user, course:course, section:section, video: video });
  } catch (err) {
    console.error(err);
    res.status(500).redirect('/student/dashboard');
  }
});




app.get('/section/:courseId/:sectionId/assignments', checkAuthenticated, async (req, res) => {
  const { sectionId,courseId } = req.params;
  const userId = req.user.userId;

  try {
    const course = await courseCollection.findOne({courseId: courseId})
    const section = await sectionCollection.findOne({ sectionId:sectionId, courseId: courseId });
    // const section = await sectionCollection.findOne({ sectionId:sectionId, courseId: courseId });
    res.status(200).render('assignments', { user: req.user, course:course, section:section });
  } catch (err) {
    console.error(err);
    res.status(500).redirect('/student/dashboard');
  }
});





app.get('/section/:courseId/:sectionId/assignment/:title', checkAuthenticated, async (req, res) => {
  const { sectionId,courseId, title } = req.params;
  const userId = req.user.userId;

  try {
    const course = await courseCollection.findOne({courseId: courseId})
    const section = await sectionCollection.findOne({ sectionId:sectionId, courseId: courseId });
    // const section = await sectionCollection.findOne({ sectionId:sectionId, courseId: courseId });
    res.status(200).render('assignment', { user: req.user, course:course, section:section, title: title });
  } catch (err) {
    console.error(err);
    res.status(500).redirect('/student/dashboard');
  }
});


app.get('/section/:courseId/:sectionId/announcements', checkAuthenticated, async (req, res) => {
  const { sectionId,courseId } = req.params;
  const userId = req.user.userId;

  try {
    const course = await courseCollection.findOne({courseId: courseId})
    const section = await sectionCollection.findOne({ sectionId:sectionId, courseId: courseId });
    // const section = await sectionCollection.findOne({ sectionId:sectionId, courseId: courseId });
    res.status(200).render('announcements', { user: req.user, course:course, section:section });
  } catch (err) {
    console.error(err);
    res.status(500).redirect('/student/dashboard');
  }
});


app.get('/search', checkAuthenticated, (req, res) => {
  res.render('search', { user: req.user });
});

app.post('/search', checkAuthenticated, async (req, res) => {
  const { username } = req.body;

  try {
    // Check in both `students` and `instructors` collections
    const user = await usersCollection.findOne({ name: username });
    console.log(user)
    if (user.role == "Student") {
      // Redirect to the student profile page
      res.redirect(`/profile/student/${user.userId}`);
    } else if (user.role == "Instructor") {
      // Redirect to the instructor profile page
      res.redirect(`/profile/instructor/${user.userId}`);
    } else {
      // If user not found
      res.status(404).render('search', { user: req.user, error: 'User not found' });
    }
  } catch (error) {
    console.error('Error in search:', error);
    res.status(500).send('An error occurred during search');
  }
});




// ---------------------------------------------------------------------------------------------------------



app.get('/student/enroll-course', checkAuthenticated, checkRole('@mavs.uta.edu'), async (req, res) => {
  try {
    res.status(200).render('studentEnrollCourse', { user: req.user, courses: null });
  } catch (err) {
    console.error(err);
    res.status(500).redirect('/student/dashboard');
  }
});

app.post('/student/enroll-course', checkAuthenticated, checkRole('@mavs.uta.edu'), async (req, res) => {
  const { searchQuery } = req.body;
  const userId = req.user.userId;

  try {
    // Search for courses matching the search query
    const courses = await courseCollection.find({
      $or: [
        { courseId: { $regex: searchQuery, $options: 'i' } },
        { name: { $regex: searchQuery, $options: 'i' } }
      ]
    }).toArray();

    // Fetch completed courses for the student
    const completedCourses = await mainDataDb.collection('academicReports')
      .find({ studentId: userId })
      .project({ courseId: 1 })
      .toArray();
    const completedCourseIds = completedCourses.map(course => course.courseId);

    // Fetch sections where the student is enrolled
    const enrolledSections = await sectionCollection.find({
      "students.studentId": userId
    }).toArray();
    const enrolledSectionIds = enrolledSections.map(section => section.courseId);

    if (courses.length > 0) {
      for (const course of courses) {
        const sections = await sectionCollection.find({ courseId: course.courseId }).toArray();
        course.sections = sections;
      }
    }

    res.status(200).render('studentEnrollCourse', { 
      user: req.user, 
      courses, 
      completedCourseIds,
      enrolledSectionIds
    });
  } catch (err) {
    console.error(err);
    res.status(500).redirect('/student/enroll-course');
  }
});


app.post('/student/enroll-course/:sectionId/enroll', checkAuthenticated, checkRole('@mavs.uta.edu'), async (req, res) => {
  const { sectionId } = req.params;
  const userId = req.user.userId;

  try {
    const section = await sectionCollection.findOne({ sectionId });
    
    if (section) {
      await sectionCollection.updateOne({ sectionId }, { $push: { students: {studentId: userId, name: req.user.name, email: req.user.email} } });
      res.status(200).redirect('/student/dashboard');
    } else {
      res.status(404).json({ message: 'Section not found' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).redirect('/student/dashboard');
  }
});


app.post('/student/section/:courseId/:sectionId/assignemnt/:title/submission', checkAuthenticated, checkRole('@mavs.uta.edu'), upload.single('moduleFile'), async (req, res) => {
  const { courseId, sectionId, title } = req.params;
  try {
    // Upload file to S3
    const result = await uploadFile(req.file); // Upload the file
    const fileUrl = result.Location; // Get the URL of the uploaded file

    // Here, you would update the course document in the database with the S3 file URL
    await submissionsCollection.updateOne(
      { courseId: courseId, sectionId: sectionId, assignmentTitle: title, studentId: req.user.userId },
      { $set: { marks: 0, link: fileUrl, studentName: req.user.name, filename: req.file.originalname, mimeType: req.file.mimetype, type: "assignment" }  },
      { upsert: true }
    );
    

    res.redirect(`/section/${courseId}/${sectionId}/assignments`); // Redirect to instructor dashboard
  } catch (error) {
    console.error('Error uploading file to S3:', error);
    res.status(500).send('Error uploading syllabus file');
  }
});

app.get('/profile/student/:userId', checkAuthenticated, async (req, res) => {
  const { userId } = req.params;
  
  try {
    const studentProfile = await mainDataDb.collection('students').findOne({ userId: parseInt(userId) });
    const user = await usersCollection.findOne({ userId: parseInt(userId) });
    if (studentProfile) {
      res.status(200).render('viewStudentProfile', { user: req.user, searchedUser: user, profile: studentProfile });
    } else {
      res.status(404).send('Student profile not found.');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Error retrieving student profile.');
  }
});


app.get('/student/section/:courseId/:sectionId/assignemnt/:title/my-submissions', checkAuthenticated, async (req, res) => {
  const { sectionId,courseId, title } = req.params;
  const userId = req.user.userId;

  try {
    var submissions = await submissionsCollection.findOne(
      { courseId: courseId, sectionId: sectionId, assignmentTitle: title, studentId: userId },
    );
    // const section = await sectionCollection.findOne({ sectionId:sectionId, courseId: courseId });
    res.status(200).render('studentSubmissions', { user: req.user, submissions: submissions });
  } catch (err) {
    console.error(err);
    res.status(500).redirect('/student/dashboard');
  }
});





app.get('/section/:courseId/:sectionId/grades', checkAuthenticated, async (req, res) => {
  const { sectionId, courseId } = req.params;
  const userId = req.user.userId;

  try {
    const submissions = await submissionsCollection.find(
      { courseId: courseId, sectionId: sectionId, studentId: userId }
    ).toArray();

    // Calculate the total weighted grade
    let totalGrade = 0;
    let assignmentGrade = 0;
    let examGrade = 0;
    let presentationGrade = 0;
    let assignmentCount = 0;
    let examCount = 0;
    let presentationCount = 0;

    submissions.forEach(submission => {
      if (submission.type === 'assignment') {
        assignmentGrade += submission.marks || 0;
        assignmentCount++;
      } else if (submission.type === 'exam') {
        examGrade += submission.marks || 0;
        examCount++;
      } else if (submission.type === 'presentation') {
        presentationGrade += submission.marks || 0;
        presentationCount++;
      }
    });

    // Calculate average marks per type if there are any submissions
    assignmentGrade = assignmentCount ? (assignmentGrade / assignmentCount) * 0.4 : 0;
    examGrade = examCount ? (examGrade / examCount) * 0.4 : 0;
    presentationGrade = presentationCount ? (presentationGrade / presentationCount) * 0.2 : 0;

    // Calculate total weighted grade
    totalGrade = assignmentGrade + examGrade + presentationGrade;

    res.status(200).render('grades', {
      user: req.user,
      submissions,
      sectionId, 
      courseId,
      totalGrade: totalGrade.toFixed(2), // Round to 2 decimal places for clarity
    });
  } catch (err) {
    console.error(err);
    res.status(500).redirect('/student/dashboard');
  }
});


app.post('/student/enroll-course', checkAuthenticated, checkRole('@mavs.uta.edu'), async (req, res) => {
  const { searchQuery } = req.body;

  try {
    const courses = await courseCollection.find({
      $or: [
        { courseId: { $regex: searchQuery, $options: 'i' } },
        { name: { $regex: searchQuery, $options: 'i' } }
      ]
    }).toArray();

    if (courses.length > 0) {
      for (const course of courses) {
        const sections = await sectionCollection.find({ courseId: course.courseId }).toArray();
        course.sections = sections;
      }
    }

    res.status(200).render('studentEnrollCourse', { user: req.user, courses });
  } catch (err) {
    console.error(err);
    res.status(500).redirect('/student/enroll-course');
  }
});



app.get('/student/profile', checkAuthenticated, checkRole('@mavs.uta.edu'), async (req, res) => {
  const studentProfile = await mainDataDb.collection('students').findOne({ userId: req.user.userId });
  res.render('studentProfileForm', { user: req.user, profile: studentProfile });
});

app.post('/student/profile', checkAuthenticated, checkRole('@mavs.uta.edu'), async (req, res) => {
  const { major, degree, graduationYear, totalCredits } = req.body;

  await mainDataDb.collection('students').updateOne(
    { userId: req.user.userId },
    { $set: { major, degree, graduationYear: Number(graduationYear), totalCredits: Number(totalCredits) } },
    { upsert: true } // Create the profile if it doesn’t exist
  );

  res.redirect('/student/profile');
});


app.get('/student/academic-report', checkAuthenticated, checkRole('@mavs.uta.edu'), async (req, res) => {
  const userId = req.user.userId;

  try {
    const reports = await mainDataDb.collection('academicReports').find({ studentId: userId }).toArray();

    if (reports.length === 0) {
      return res.status(404).send('No academic reports found.');
    }

    res.render('academicReport', {
      user: req.user,
      reports: reports,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error retrieving academic reports');
  }
});




app.listen(process.env.PORT || 3000, () => {
  console.log(`Server started on port ${process.env.PORT || 3000}`);
});

export default app;
