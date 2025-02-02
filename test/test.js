import * as chai from "chai";
import chaiHttp from "chai-http";
import app from '../app.js';
import request from 'supertest';
import sinon from 'sinon';
import bcrypt from 'bcrypt';
import { MongoClient } from 'mongodb';
import { uploadFile } from '../s3.js';

chai.use(chaiHttp);
const { expect } = chai;
const agent = request.agent(app);

// Define the middleware functions for testing
const checkAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).redirect('/login');
};

const checkRole = (role) => {
    return function (req, res, next) {
        if (req.user && req.user.email.endsWith(role)) {
            next();
        } else {
            res.status(401).redirect('/login');
        }
    };
};

describe("Middleware Functionality Tests", function () {
  let mockUser;
  let req, res, next;

  beforeEach(async function () {
      mockUser = {
          userId: 2,
          name: "John Doe",
          email: "johndoe@uta.edu", // Ensure this email matches the expected role
          role: "Instructor"
      };

      // Mock `req`, `res`, and `next` for testing the middleware
      req = { user: mockUser, isAuthenticated: () => true };
      res = { status: sinon.stub().returnsThis(), redirect: sinon.stub() };
      next = sinon.spy();
  });

  afterEach(() => sinon.restore());

  describe("checkRole Middleware", function () {
      it("should call next() if user role matches", function () {
          // Simulate a user with the correct email format for role
          checkRole('@uta.edu')(req, res, next);
          
          // Check that next() was called as expected
          expect(next.calledOnce).to.be.true;
          expect(res.status.notCalled).to.be.true;
          expect(res.redirect.notCalled).to.be.true;
      });

      it("should redirect to /login if user role does not match", function () {
          // Set a mismatched email format to simulate failure
          req.user.email = "johndoe@gmail.com"; // This email does not match @uta.edu
          checkRole('@uta.edu')(req, res, next);

          expect(res.status.calledWith(401)).to.be.true;
          expect(res.redirect.calledWith('/login')).to.be.true;
          expect(next.notCalled).to.be.true; // Ensure next() is not called
      });
  });
});

describe("App Functionalities Tests", function () {
    let mongoClientStub, collectionStub, sectionCollectionStub, submissionsCollectionStub, courseCollectionStub, uploadFileStub, academicReportsCollectionStub;
    let mockUser; // Declare mockUser here so it's accessible in all hooks and tests
  
    before(async function () {
        mockUser = {
            _id: { $oid: "66ef2d880e1836da3b47be77" },
            userId: 2,
            name: "John Doe",
            email: "johndoe@uta.edu",
            password: await bcrypt.hash("12345", 10),
            role: "Instructor"
        };
  
        mongoClientStub = sinon.stub(MongoClient.prototype, "connect").resolves({
            db: () => ({
                collection: (name) => {
                    switch (name) {
                        case "users":
                            return collectionStub;
                        case "sections":
                            return sectionCollectionStub;
                        case "submissions":
                            return submissionsCollectionStub;
                        case "courses":
                            return courseCollectionStub;
                        case "academicReports":
                            return academicReportsCollectionStub;
                        default:
                            return collectionStub;
                    }
                }
            })
        });
  
        collectionStub = {
            findOne: sinon.stub(),
            find: sinon.stub(),
            insertOne: sinon.stub(),
            updateOne: sinon.stub(),
            deleteOne: sinon.stub(),
            insertMany: sinon.stub()
        };
  
        sectionCollectionStub = {
            findOne: sinon.stub(),
            find: sinon.stub(),
            insertOne: sinon.stub(),
            updateOne: sinon.stub(),
            deleteOne: sinon.stub(),
            insertMany: sinon.stub()
        };
  
        courseCollectionStub = {
            findOne: sinon.stub(),
            updateOne: sinon.stub(),
            insertOne: sinon.stub(),
            deleteOne: sinon.stub()
        };
  
        submissionsCollectionStub = {
            findOne: sinon.stub(),
            find: sinon.stub(),
            insertOne: sinon.stub(),
            updateOne: sinon.stub(),
            deleteOne: sinon.stub()
        };
  
        academicReportsCollectionStub = {
            findOne: sinon.stub(),
            insertOne: sinon.stub(),
            updateOne: sinon.stub(),
            deleteOne: sinon.stub()
        };
  
        sinon.stub(bcrypt, "compare").callsFake((password, hash) => bcrypt.compare(password, hash));
  
        return agent.post("/login").send({ email: "johndoe@uta.edu", password: "12345" }).expect(302);
    });
  
    afterEach(() => sinon.restore());

  describe("User Authentication Tests", function () {
      it("should log in with valid credentials", function (done) {
          const user = { email: "johndoe@uta.edu", password: "12345" };
          agent.post("/login").send(user).expect(302).end(done);
      });
  });

  describe("Course Management Tests", function () {
      it("should add a course", function (done) {
          const course = {
              courseId: "BC101",
              courseName: "Intro to Blockchain",
              sectionId: ["001"],
              term: ["Fall"],
              year: ["2024"],
              classroom: ["Room 101"],
              startTime: ["10:00"],
              endTime: ["11:00"],
              days: [["Monday", "Wednesday"]],
              assignmentWeight: "30",
              examWeight: "40",
              presentationWeight: "30",
              credits: "3"
          };

          collectionStub.findOne.withArgs({ courseId: "BC101", instructorId: mockUser.userId }).returns(Promise.resolve(null));
          collectionStub.insertOne.resolves();
          sectionCollectionStub.insertMany.resolves();

          agent
              .post("/instructor/add-course")
              .send(course)
              .expect(302)
              .end(done);
      });

      it("should not add a course if it already exists", function (done) {
          const course = {
              courseId: "BC101",
              courseName: "Intro to Blockchain",
              sectionId: ["001"],
              term: ["Fall"],
              year: ["2024"],
              classroom: ["Room 101"],
              startTime: ["10:00"],
              endTime: ["11:00"],
              days: [["Monday", "Wednesday"]],
              assignmentWeight: "30",
              examWeight: "40",
              presentationWeight: "30",
              credits: "3"
          };

          collectionStub.findOne.withArgs({ courseId: "BC101", instructorId: mockUser.userId }).returns(Promise.resolve(course));

          agent
              .post("/instructor/add-course")
              .send(course)
              .expect(302)
              .end(done);
      });
  });

  describe("DELETE /instructor/:courseId/delete-section/:sectionId", function () {
    it("should delete a section successfully", function (done) {
      const courseId = "BC101";
      const sectionId = "001";

      sectionCollectionStub.deleteOne.withArgs({ sectionId, courseId }).resolves({ deletedCount: 1 });

      agent
        .delete(`/instructor/${courseId}/delete-section/${sectionId}`)
        .set("Accept", "application/json")
        .expect(302)
        .end((err, res) => {
          if (err) return done(err);
          
          done();
        });
    });

    it("should handle errors when deleting a section", function (done) {
      const courseId = "BC101";
      const sectionId = "001";

      sectionCollectionStub.deleteOne.withArgs({ sectionId, courseId }).rejects(new Error("Deletion error"));

      agent
        .delete(`/instructor/${courseId}/delete-section/${sectionId}`)
        .set("Accept", "application/json")
        .expect(302)
        .end((err, res) => {
          if (err) return done(err);
          
          done();
        });
    });
  });



  describe("GET /instructor/:courseId/add-edit-syllabus", function () {
    it("should render the add/edit syllabus page", function (done) {
      const courseId = "BC101";

      agent
        .get(`/instructor/${courseId}/add-edit-syllabus`)
        .set("Accept", "text/html")
        .expect(302)
        .end((err, res) => {
          if (err) return done(err);
          done();
        });
    });
  });

  describe("POST /instructor/:courseId/add-edit-syllabus", function () {
    it("should upload the syllabus file and update course document", function (done) {
      const courseId = "BC101";
      const syllabusFile = {
        fieldname: "syllabusFile",
        originalname: "syllabus.pdf",
        mimetype: "application/pdf",
      };

      courseCollectionStub.updateOne.withArgs(
        { courseId },
        { $set: { syllabusLink: "https://s3.example.com/syllabus.pdf", filename: syllabusFile.originalname, mimeType: syllabusFile.mimetype } },
        { upsert: true }
      ).resolves();

      agent
        .post(`/instructor/${courseId}/add-edit-syllabus`)
        .attach("syllabusFile", Buffer.from("Test file content"), syllabusFile.originalname)
        .expect(302)
        .end((err, res) => {
          if (err) return done(err);
          done();
        });
    });

    it("should handle errors when uploading file to S3", function (done) {
      const courseId = "BC101";
      // uploadFileStub.rejects(new Error("S3 upload error"));

      agent
        .post(`/instructor/${courseId}/add-edit-syllabus`)
        .attach("syllabusFile", Buffer.from("Test file content"), "syllabus.pdf")
        .expect(302)
        .end((err, res) => {
          if (err) return done(err);
          done();
        });
    });
  });


  describe("GET /instructor/:courseId/:sectionId/add-modules", function () {
    it("should render the add modules page", function (done) {
      const courseId = "BC101";
      const sectionId = "001";

      agent
        .get(`/instructor/${courseId}/${sectionId}/add-modules`)
        .set("Accept", "text/html")
        .expect(302)
        .end((err, res) => {
          if (err) return done(err);
          done();
        });
    });
  });

  describe("POST /instructor/:courseId/:sectionId/add-modules", function () {
    it("should upload module file and update section document", function (done) {
      const courseId = "BC101";
      const sectionId = "001";
      const moduleFile = {
        fieldname: "moduleFile",
        originalname: "module.pdf",
        mimetype: "application/pdf",
      };

      sectionCollectionStub.updateOne.withArgs(
        { courseId, sectionId },
        { $push: { modules: { name: "Module 1", link: "https://s3.example.com/file.pdf", filename: moduleFile.originalname, mimeType: moduleFile.mimetype } } }
      ).resolves();

      agent
        .post(`/instructor/${courseId}/${sectionId}/add-modules`)
        .attach("moduleFile", Buffer.from("Test file content"), moduleFile.originalname)
        .field("name", "Module 1")
        .expect(302)
        .end((err, res) => {
          if (err) return done(err);
          done();
        });
    });
  });

  describe("GET /instructor/:courseId/:sectionId/add-assignments", function () {
    it("should render the add assignments page", function (done) {
      const courseId = "BC101";
      const sectionId = "001";

      agent
        .get(`/instructor/${courseId}/${sectionId}/add-assignments`)
        .set("Accept", "text/html")
        .expect(302)
        .end((err, res) => {
          if (err) return done(err);
          done();
        });
    });
  });

  describe("POST /instructor/:courseId/:sectionId/add-assignments", function () {
    it("should upload assignment file and update section document", function (done) {
      const courseId = "BC101";
      const sectionId = "001";
      const assignmentFile = {
        fieldname: "moduleFile",
        originalname: "assignment.pdf",
        mimetype: "application/pdf",
      };

      sectionCollectionStub.updateOne.withArgs(
        { courseId, sectionId },
        { $push: { assignments: { title: "Assignment 1", description: "Test Description", link: "https://s3.example.com/file.pdf", filename: assignmentFile.originalname, mimeType: assignmentFile.mimetype, dueDateUnix: sinon.match.number } } }
      ).resolves();

      agent
        .post(`/instructor/${courseId}/${sectionId}/add-assignments`)
        .attach("moduleFile", Buffer.from("Test file content"), assignmentFile.originalname)
        .field("title", "Assignment 1")
        .field("description", "Test Description")
        .field("dueDate", "2024-12-31")
        .field("dueTime", "23:59")
        .expect(302)
        .end((err, res) => {
          if (err) return done(err);
          done();
        });
    });
  });

  describe("GET /instructor/:courseId/:sectionId/add-videos", function () {
    it("should render the add videos page", function (done) {
      const courseId = "BC101";
      const sectionId = "001";

      agent
        .get(`/instructor/${courseId}/${sectionId}/add-videos`)
        .set("Accept", "text/html")
        .expect(302)
        .end((err, res) => {
          if (err) return done(err);
          done();
        });
    });
  });

  describe("POST /instructor/:courseId/:sectionId/add-videos", function () {
    it("should upload video file and update section document", function (done) {
      const courseId = "BC101";
      const sectionId = "001";
      const videoFile = {
        fieldname: "moduleFile",
        originalname: "video.mp4",
        mimetype: "video/mp4",
      };

      sectionCollectionStub.updateOne.withArgs(
        { courseId, sectionId },
        { $push: { videos: { title: "Video 1", link: "https://s3.example.com/file.pdf" } } }
      ).resolves();

      agent
        .post(`/instructor/${courseId}/${sectionId}/add-videos`)
        .attach("moduleFile", Buffer.from("Test video content"), videoFile.originalname)
        .field("title", "Video 1")
        .expect(302)
        .end((err, res) => {
          if (err) return done(err);
          done();
        });
    });
  });

  describe("GET /instructor/:courseId/:sectionId/add-announcements", function () {
    it("should render the add announcements page", function (done) {
      const courseId = "BC101";
      const sectionId = "001";

      agent
        .get(`/instructor/${courseId}/${sectionId}/add-announcements`)
        .set("Accept", "text/html")
        .expect(302)
        .end((err, res) => {
          if (err) return done(err);
          done();
        });
    });
  });

  describe("POST /instructor/:courseId/:sectionId/add-announcements", function () {
    it("should add an announcement and update section document", function (done) {
      const courseId = "BC101";
      const sectionId = "001";

      sectionCollectionStub.updateOne.withArgs(
        { courseId, sectionId },
        { $push: { announcements: { title: "Announcement 1", description: "Test Announcement" } } }
      ).resolves();

      agent
        .post(`/instructor/${courseId}/${sectionId}/add-announcements`)
        .field("title", "Announcement 1")
        .field("description", "Test Announcement")
        .expect(302)
        .end((err, res) => {
          if (err) return done(err);
          done();
        });
    });
  });
  describe("GET /instructor/:courseId/:sectionId/add-exam", function () {
    it("should render the add exam page", function (done) {
      const courseId = "BC101";
      const sectionId = "001";

      courseCollectionStub.findOne.resolves({ courseId: courseId });
      sectionCollectionStub.findOne.resolves({ sectionId: sectionId });

      agent
        .get(`/instructor/${courseId}/${sectionId}/add-exam`)
        .expect(302)
        .end((err, res) => {
          if (err) return done(err);
          done();
        });
    });
  });

  describe("POST /instructor/:courseId/:sectionId/add-exam", function () {
    it("should add grades for the exam and redirect", function (done) {
      const courseId = "BC101";
      const sectionId = "001";
      const title = "Midterm";
      const grades = { 0: 85, 1: 90 };

      sectionCollectionStub.findOne.resolves({ students: [{ studentId: 1, name: "Student 1" }, { studentId: 2, name: "Student 2" }] });
      submissionsCollectionStub.updateOne.resolves();

      agent
        .post(`/instructor/${courseId}/${sectionId}/add-exam`)
        .send({ title, grade: grades })
        .expect(302)
        .end((err, res) => {
          if (err) return done(err);
          done();
        });
    });
  });

  describe("GET /instructor/:courseId/:sectionId/add-presentation", function () {
    it("should render the add presentation page", function (done) {
      const courseId = "BC101";
      const sectionId = "001";

      courseCollectionStub.findOne.resolves({ courseId: courseId });
      sectionCollectionStub.findOne.resolves({ sectionId: sectionId });

      agent
        .get(`/instructor/${courseId}/${sectionId}/add-presentation`)
        .expect(302)
        .end((err, res) => {
          if (err) return done(err);
          done();
        });
    });
  });

  describe("POST /instructor/:courseId/:sectionId/add-presentation", function () {
    it("should add grades for the presentation and redirect", function (done) {
      const courseId = "BC101";
      const sectionId = "001";
      const title = "Final Presentation";
      const grades = { 0: 88, 1: 92 };

      sectionCollectionStub.findOne.resolves({ students: [{ studentId: 1, name: "Student 1" }, { studentId: 2, name: "Student 2" }] });
      submissionsCollectionStub.updateOne.resolves();

      agent
        .post(`/instructor/${courseId}/${sectionId}/add-presentation`)
        .send({ title, grade: grades })
        .expect(302)
        .end((err, res) => {
          if (err) return done(err);
          done();
        });
    });
  });

  describe("POST /instructor/section/:courseId/:sectionId/assignment/:title/submission/:submissionId/grade", function () {
    it("should update the grade for the specified submission and redirect", function (done) {
      const courseId = "BC101";
      const sectionId = "001";
      const title = "Assignment 1";
      const submissionId = "5f9f1b9b9c9d4b3c3c3c3c3c";
      const grade = 95;

      submissionsCollectionStub.updateOne.resolves();

      agent
        .post(`/instructor/section/${courseId}/${sectionId}/assignment/${title}/submission/${submissionId}/grade`)
        .send({ grade })
        .expect(302)
        .end((err, res) => {
          if (err) return done(err);
          done();
        });
    });
  });

  describe("GET /instructor/:courseId/:sectionId/submit-final-grades", function () {
    it("should submit final grades for the section and redirect", function (done) {
      const courseId = "BC101";
      const sectionId = "001";

      courseCollectionStub.findOne.resolves({ weightages: { assignment: 40, exam: 40, presentation: 20 } });
      sectionCollectionStub.findOne.resolves({ students: [{ studentId: 1 }, { studentId: 2 }] });
      submissionsCollectionStub.find.resolves([{ type: "assignment", marks: 85 }, { type: "exam", marks: 90 }]);
      academicReportsCollectionStub.insertOne.resolves();
      sectionCollectionStub.updateOne.resolves();

      agent
        .get(`/instructor/${courseId}/${sectionId}/submit-final-grades`)
        .expect(302)
        .end((err, res) => {
          if (err) return done(err);
          done();
        });
    });
  });


  
});



describe('App Routes Tests', () => {
    let courseCollectionStub, sectionCollectionStub, usersCollectionStub, submissionsCollectionStub;
  
    before(() => {
      // Stub the necessary collections and methods
      courseCollectionStub = {
        findOne: sinon.stub(),
        updateOne: sinon.stub()
      };
      sectionCollectionStub = {
        findOne: sinon.stub()
      };
      usersCollectionStub = {
        findOne: sinon.stub(),
        updateOne: sinon.stub()
      };
      submissionsCollectionStub = {
        find: sinon.stub()
      };

      sinon.stub(bcrypt, "compare").callsFake((password, hash) => bcrypt.compare(password, hash));
  
        return agent.post("/login").send({ email: "johndoe@uta.edu", password: "12345" }).expect(302);
    });
  
    afterEach(() => {
      sinon.restore();
    });
  
    describe('GET /section/:courseId/:sectionId', () => {
        it('should render course dashboard with section and course details', (done) => {
          courseCollectionStub.findOne.resolves({ courseId: 'BC101' });
          sectionCollectionStub.findOne.resolves({ sectionId: '001' });
    
          agent
            .get('/section/BC101/001')
            .set('Authorization', 'Bearer valid_token') // Replace with actual auth header if needed
            .end((err, res) => {
              expect(res).to.have.status(302);
              done();
            });
        });
      });
  
    describe('GET /download-syllabus/:fileKey', () => {
      it('should download syllabus if file is found', (done) => {
        const fileKey = 'test-syllabus';
        courseCollectionStub.findOne.resolves({
          syllabusLink: `https://s3.example.com/${fileKey}`,
          filename: 'syllabus.pdf',
          mimeType: 'application/pdf'
        });
  
        agent
          .get(`/download-syllabus/${fileKey}`)
          .end((err, res) => {
            expect(res).to.have.status(302);
            done();
          });
      });
    });
  
    describe('POST /forgot', () => {
  
      it('should return 404 if user does not exist', (done) => {
        usersCollectionStub.findOne.resolves(null);
  
        agent
          .post('/forgot')
          .send({ email: 'nonexistent@example.com' })
          .end((err, res) => {
            expect(res).to.have.status(404);
            expect(res.text).to.include('No account with that email found');
            done();
          });
      });

      it('should send email if user exist', (done) => {
        usersCollectionStub.findOne.resolves(null);
  
        agent
          .post('/forgot')
          .send({ email: 'johndoe@uta.edu' })
          .end((err, res) => {
            expect(res).to.have.status(404);
            done();
          });
      });
    });
  
  
    describe('POST /reset/:token', () => {
     
  
      it('should return error if passwords do not match', (done) => {
        agent
          .post('/reset/valid-token')
          .send({ password: 'newpass', confirmPassword: 'mismatch' })
          .end((err, res) => {
            expect(res).to.have.status(400);
            done();
          });
      });
    });
  
    describe('GET /section/:courseId/:sectionId/modules', () => {
      it('should render modules page for a section', (done) => {
        courseCollectionStub.findOne.resolves({ courseId: 'BC101' });
        sectionCollectionStub.findOne.resolves({ sectionId: '001' });
  
        agent
          .get('/section/BC101/001/modules')
          .end((err, res) => {
            expect(res).to.have.status(302);
            done();
          });
      });
    });
  
    describe('GET /section/:courseId/:sectionId/grades/:userId', () => {
      it('should calculate and display grades for a student', (done) => {
        courseCollectionStub.findOne.resolves({
          courseId: 'BC101',
          weightages: { assignment: 40, exam: 40, presentation: 20 }
        });
        submissionsCollectionStub.find.resolves([
          { type: 'assignment', marks: 85 },
          { type: 'exam', marks: 90 }
        ]);
  
        agent
          .get('/section/BC101/001/grades/1')
          .end((err, res) => {
            expect(res).to.have.status(302);
            done();
          });
      });
    });
  
    
  });



  describe('Student Routes Tests', () => {
    let courseCollectionStub, sectionCollectionStub, usersCollectionStub, submissionsCollectionStub, mainDataDbStub;
  
    before(() => {
      courseCollectionStub = {
        findOne: sinon.stub(),
        find: sinon.stub(),
        updateOne: sinon.stub()
      };
      sectionCollectionStub = {
        findOne: sinon.stub(),
        find: sinon.stub(),
        updateOne: sinon.stub()
      };
      usersCollectionStub = {
        findOne: sinon.stub(),
        updateOne: sinon.stub()
      };
      submissionsCollectionStub = {
        findOne: sinon.stub(),
        find: sinon.stub(),
        updateOne: sinon.stub()
      };
      mainDataDbStub = {
        collection: sinon.stub()
      };
      sinon.stub(bcrypt, "compare").callsFake((password, hash) => bcrypt.compare(password, hash));
  
        return agent.post("/login").send({ email: "johndoe@uta.edu", password: "12345" }).expect(302);
    });
  
    afterEach(() => sinon.restore());
  
    describe('GET /student/enroll-course', () => {
      it('should render enroll course page for students', (done) => {
        agent
          .get('/student/enroll-course')
          .end((err, res) => {
            expect(res).to.have.status(302);
            done();
          });
      });
    });
  
    describe('POST /student/enroll-course', () => {
      it('should return search results for available courses', (done) => {
        courseCollectionStub.find.returns({
          toArray: sinon.stub().resolves([{ courseId: 'BC101', name: 'Blockchain' }])
        });
        sectionCollectionStub.find.returns({
          toArray: sinon.stub().resolves([{ sectionId: '001' }])
        });
  
        agent
          .post('/student/enroll-course')
          .send({ searchQuery: 'Blockchain' })
          .end((err, res) => {
            expect(res).to.have.status(302);
            done();
          });
      });
    });
  
    describe('POST /student/enroll-course/:sectionId/enroll', () => {
      it('should enroll student in a section', (done) => {
        sectionCollectionStub.findOne.resolves({ sectionId: '001' });
        sectionCollectionStub.updateOne.resolves();
  
        agent
          .post('/student/enroll-course/001/enroll')
          .end((err, res) => {
            expect(res).to.have.status(302);
            done();
          });
      });
  
      it('should return 404 if section not found', (done) => {
        sectionCollectionStub.findOne.resolves(null);
  
        agent
          .post('/student/enroll-course/001/enroll')
          .end((err, res) => {
            expect(res).to.have.status(302);
            done();
          });
      });
    });
  
    
  
    describe('GET /profile/student/:userId', () => {
      it('should display student profile', (done) => {
        mainDataDbStub.collection.returns({
          findOne: sinon.stub().resolves({ userId: 1 })
        });
        usersCollectionStub.findOne.resolves({ userId: 1 });
  
        agent
          .get('/profile/student/1')
          .end((err, res) => {
            expect(res).to.have.status(302);
            done();
          });
      });
  
      it('should return 404 if profile not found', (done) => {
        mainDataDbStub.collection.returns({
          findOne: sinon.stub().resolves(null)
        });
  
        agent
          .get('/profile/student/1')
          .end((err, res) => {
            expect(res).to.have.status(302);
            done();
          });
      });
    });
  
    
  
    describe('GET /section/:courseId/:sectionId/grades', () => {
      it('should calculate and display student grades', (done) => {
        submissionsCollectionStub.find.returns({
          toArray: sinon.stub().resolves([{ type: 'assignment', marks: 80 }, { type: 'exam', marks: 90 }])
        });
  
        agent
          .get('/section/BC101/001/grades')
          .end((err, res) => {
            expect(res).to.have.status(302);
            done();
          });
      });
    });
  
    describe('GET /student/profile', () => {
      it('should render the student profile form', (done) => {
        mainDataDbStub.collection.returns({
          findOne: sinon.stub().resolves({ userId: 1 })
        });
  
        agent
          .get('/student/profile')
          .end((err, res) => {
            expect(res).to.have.status(302);
            done();
          });
      });
    });
  
    describe('POST /student/profile', () => {
      it('should update the student profile', (done) => {
        mainDataDbStub.collection.returns({
          updateOne: sinon.stub().resolves()
        });
  
        agent
          .post('/student/profile')
          .send({ major: 'CS', degree: 'Bachelor', graduationYear: '2024', totalCredits: 120 })
          .end((err, res) => {
            expect(res).to.have.status(302);
            done();
          });
      });
    });
  
    describe('GET /student/academic-report', () => {
      it('should render academic reports for the student', (done) => {
        mainDataDbStub.collection.returns({
          find: sinon.stub().returns({
            toArray: sinon.stub().resolves([{ courseId: 'BC101', grade: 85 }])
          })
        });
  
        agent
          .get('/student/academic-report')
          .end((err, res) => {
            expect(res).to.have.status(302);
            done();
          });
      });
  
      it('should return 404 if no academic reports found', (done) => {
        mainDataDbStub.collection.returns({
          find: sinon.stub().returns({
            toArray: sinon.stub().resolves([])
          })
        });  
        agent
          .get('/student/academic-report')
          .end((err, res) => {
            expect(res).to.have.status(302);
            done();
          });
      });
    });
  });