require('dotenv').config();
const express=require('express'),session=require('express-session'),MySQLStoreFactory=require('express-mysql-session');
const mysql=require('mysql2/promise'),bcrypt=require('bcryptjs'),multer=require('multer'),path=require('path'),fs=require('fs'),crypto=require('crypto'),helmet=require('helmet');
const app=express(),PORT=Number(process.env.PORT||3000);

const db = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'campus_fault_db',
  ssl: {
    ca: fs.readFileSync(path.join(__dirname, 'aiven-ca.pem'))
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool=mysql.createPool(db),MySQLStore=MySQLStoreFactory(session);
const store=new MySQLStore({...db,createDatabaseTable:true,schema:{tableName:'sessions'}});
app.use(helmet({contentSecurityPolicy:false}));app.use(express.json({limit:'1mb'}));app.use(express.urlencoded({extended:true}));
app.use(session({name:'campusfix.sid',secret:process.env.SESSION_SECRET||'change-this-development-secret',resave:false,saveUninitialized:false,store,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000}}));
const uploadDir=path.join(__dirname,'public','uploads');fs.mkdirSync(uploadDir,{recursive:true});
const upload=multer({storage:multer.diskStorage({destination:uploadDir,filename:(_r,f,cb)=>cb(null,Date.now()+'-'+crypto.randomBytes(10).toString('hex')+path.extname(f.originalname).toLowerCase())}),limits:{fileSize:4*1024*1024},fileFilter:(_r,f,cb)=>['image/jpeg','image/png','image/webp'].includes(f.mimetype)?cb(null,true):cb(new Error('Only JPG, PNG and WEBP photos are allowed.'))});
app.use(express.static(path.join(__dirname,'public')));
const route=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const me=req=>req.session.user;
const auth=(req,res,next)=>me(req)?next():res.status(401).json({error:'Please sign in first.'});
const roles=(...list)=>(req,res,next)=>!me(req)?res.status(401).json({error:'Please sign in first.'}):list.includes(me(req).role)?next():res.status(403).json({error:'Access denied.'});
const publicUser=u=>({id:u.id,name:u.name,email:u.email,username:u.username||null,role:u.role});
async function history(rid,uid,status,note){await pool.execute('INSERT INTO status_history(report_id,changed_by,status,note) VALUES(?,?,?,?)',[rid,uid||null,status,note||null]);}
async function notify(uid,rid,message){await pool.execute('INSERT INTO notifications(user_id,report_id,message) VALUES(?,?,?)',[uid,rid,message]);}
app.get('/api/health',(_q,s)=>s.json({ok:true,service:'CampusFix'}));
app.get('/api/me',(q,s)=>s.json({user:me(q)||null}));
app.post('/api/register',route(async(q,s)=>{
 const name=String(q.body.name||'').trim(),email=String(q.body.email||'').trim().toLowerCase(),password=String(q.body.password||''),role=q.body.role||'student';
 if(!name||name.length>100)return s.status(400).json({error:'Enter a name (maximum 100 characters).'});
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return s.status(400).json({error:'Enter a valid email address.'});
 if(!['student','faculty'].includes(role))return s.status(400).json({error:'Choose Student or Faculty.'});
 if(password.length<8)return s.status(400).json({error:'Password must contain at least 8 characters.'});
 try{await pool.execute('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)',[name,email,await bcrypt.hash(password,12),role]);s.status(201).json({message:'Account created. Please sign in.'});}
 catch(e){if(e.code==='ER_DUP_ENTRY')return s.status(409).json({error:'That email is already registered.'});throw e;}
}));
app.post('/api/login',route(async(q,s)=>{
 const identity=String(q.body.username||q.body.email||'').trim().toLowerCase(),password=String(q.body.password||''),requestedRole=String(q.body.role||'');
 if(!['student','faculty','admin','repair_staff'].includes(requestedRole))return s.status(400).json({error:'Choose a valid role.'});
 const [rows]=await pool.execute('SELECT * FROM users WHERE (email=? OR username=?) AND is_active=1 AND role=?',[identity,identity,requestedRole]);
 if(!rows.length||!await bcrypt.compare(password,rows[0].password_hash))return s.status(401).json({error:'Invalid credentials for the selected role.'});
 q.session.regenerate(err=>{if(err)return s.status(500).json({error:'Could not start session.'});q.session.user=publicUser(rows[0]);q.session.save(e=>e?s.status(500).json({error:'Could not save session.'}):s.json({message:'Signed in successfully.',user:q.session.user}));});
}));
app.post('/api/logout',(q,s)=>q.session.destroy(e=>e?s.status(500).json({error:'Could not log out.'}):(s.clearCookie('campusfix.sid'),s.json({message:'Signed out.'}))));
app.post('/api/reports',auth,upload.single('photo'),route(async(q,s)=>{
 const b=q.body,title=String(b.title||'').trim(),category=String(b.category||''),department=String(b.department||'').trim(),location=String(b.location||'').trim(),description=String(b.description||'').trim(),priority=['normal','urgent'].includes(b.priority)?b.priority:'normal';
 if(!title||title.length>150||!['Furniture','Electrical','Plumbing','Building / Tiles','Cleanliness','Water supply','Network / IT','Other'].includes(category)||!department||department.length>100||!location||location.length>180||!description||description.length>3000){if(q.file)fs.unlink(q.file.path,()=>{});return s.status(400).json({error:'Complete all required fields with valid values.'});}
 const conn=await pool.getConnection();
 try{await conn.beginTransaction();const [result]=await conn.execute('INSERT INTO reports(user_id,title,category,department,location,description,priority,photo_path,status) VALUES(?,?,?,?,?,?,?,?,?)',[me(q).id,title,category,department,location,description,priority,q.file?'/uploads/'+q.file.filename:null,'Submitted']);const id=result.insertId,tracking='CF-'+String(id).padStart(5,'0');await conn.execute('UPDATE reports SET tracking_code=? WHERE id=?',[tracking,id]);await conn.execute('INSERT INTO status_history(report_id,changed_by,status,note) VALUES(?,?,?,?)',[id,me(q).id,'Submitted','Report submitted by reporter.']);const [admins]=await conn.execute("SELECT id FROM users WHERE role='admin' AND is_active=1");for(const a of admins)await conn.execute('INSERT INTO notifications(user_id,report_id,message) VALUES(?,?,?)',[a.id,id,`New fault report ${tracking} needs review.`]);await conn.commit();s.status(201).json({message:'Report submitted. Tracking ID: '+tracking,id,tracking_code:tracking});}
 catch(e){await conn.rollback();if(q.file)fs.unlink(q.file.path,()=>{});throw e;}finally{conn.release();}
}));
app.get('/api/reports',auth,route(async(q,s)=>{
 const u=me(q);let sql='SELECT r.*,u.name reporter FROM reports r JOIN users u ON u.id=r.user_id',p=[];
 if(['student','faculty'].includes(u.role)){sql+=' WHERE r.user_id=?';p.push(u.id);}else if(u.role==='repair_staff'){sql+=" WHERE r.assigned_staff_id=? AND r.status IN ('Accepted','In Progress')";p.push(u.id);}
 sql+=" ORDER BY FIELD(r.priority,'urgent','normal'),r.created_at DESC";const [reports]=await pool.execute(sql,p);
 const [rows]=await pool.query("SELECT status,COUNT(*) total FROM reports "+(['student','faculty'].includes(u.role)?'WHERE user_id='+pool.escape(u.id):u.role==='repair_staff'?"WHERE assigned_staff_id="+pool.escape(u.id)+" AND status IN ('Accepted','In Progress')":'')+" GROUP BY status");
 const counts={};for(const r of rows)counts[r.status]=Number(r.total);if(u.role==='admin')counts.All=reports.length;if(u.role==='repair_staff')counts.Assigned=reports.length;
 s.json({reports,counts,role:u.role});
}));
app.get('/api/reports/:id',auth,route(async(q,s)=>{
 const id=Number(q.params.id);if(!Number.isInteger(id)||id<1)return s.status(400).json({error:'Invalid report ID.'});
 const [rr]=await pool.execute('SELECT r.*,u.name reporter,u.email reporter_email FROM reports r JOIN users u ON u.id=r.user_id WHERE r.id=?',[id]);if(!rr.length)return s.status(404).json({error:'Report not found.'});
 const r=rr[0],u=me(q);if(!['admin','repair_staff'].includes(u.role)&&Number(r.user_id)!==Number(u.id))return s.status(403).json({error:'Access denied.'});
 const [historyRows]=await pool.execute('SELECT h.*,u.name actor FROM status_history h LEFT JOIN users u ON u.id=h.changed_by WHERE h.report_id=? ORDER BY h.created_at DESC',[id]);s.json({report:r,history:historyRows,role:u.role});
}));
app.post('/api/reports/:id/admin-action',roles('admin'),route(async(q,s)=>{
 const id=Number(q.params.id),action=q.body.action,reason=String(q.body.reason||'').trim(),days=Number(q.body.expected_days),staffId=Number(q.body.staff_id)||null;const [rr]=await pool.execute('SELECT * FROM reports WHERE id=?',[id]);if(!rr.length)return s.status(404).json({error:'Report not found.'});const r=rr[0];if(['Completed','Declined'].includes(r.status))return s.status(400).json({error:'Report is already closed.'});
 let status,dayVal=null,note;if(action==='decline'){if(!reason)return s.status(400).json({error:'A reason is required to decline.'});status='Declined';note='Declined: '+reason;}else if(action==='accept'){if(!Number.isInteger(days)||days<1||days>365)return s.status(400).json({error:'Enter repair days from 1 to 365.'});status='Accepted';dayVal=days;note=`Accepted. Estimated repair time: ${days} day(s). ${reason}`;}else return s.status(400).json({error:'Invalid action.'});
 if(action==='accept'&&!staffId)return s.status(400).json({error:'Choose repairing staff to assign this report.'});
 if(action==='accept'){const [staff]=await pool.execute("SELECT id FROM users WHERE id=? AND role='repair_staff' AND is_active=1",[staffId]);if(!staff.length)return s.status(400).json({error:'Selected repairing staff account was not found.'});}
 const c=await pool.getConnection();try{await c.beginTransaction();await c.execute('UPDATE reports SET status=?,admin_reason=?,expected_days=?,assigned_staff_id=? WHERE id=?',[status,reason||null,dayVal,action==='accept'?staffId:null,id]);await c.execute('INSERT INTO status_history(report_id,changed_by,status,note) VALUES(?,?,?,?)',[id,me(q).id,status,note]);await c.execute('INSERT INTO notifications(user_id,report_id,message) VALUES(?,?,?)',[r.user_id,id,`Your report ${r.tracking_code} was marked ${status}. ${reason}`]);if(action==='accept')await c.execute('INSERT INTO notifications(user_id,report_id,message) VALUES(?,?,?)',[staffId,id,`New repair assigned: ${r.tracking_code} - ${r.title}. Please review the task.`]);await c.commit();s.json({message:'Decision saved.'});}catch(e){await c.rollback();throw e;}finally{c.release();}
}));
app.post('/api/reports/:id/staff-update',roles('repair_staff'),route(async(q,s)=>{
 const id=Number(q.params.id),status=q.body.status,note=String(q.body.note||'').trim();if(!['In Progress','Completed'].includes(status)||!note)return s.status(400).json({error:'Choose status and enter a work note.'});
 const [rr]=await pool.execute("SELECT * FROM reports WHERE id=? AND assigned_staff_id=? AND status IN ('Accepted','In Progress')",[id,me(q).id]);if(!rr.length)return s.status(404).json({error:'Report is not available for repair update.'});const r=rr[0],c=await pool.getConnection();
 try{await c.beginTransaction();await c.execute('UPDATE reports SET status=?,completion_note=? WHERE id=?',[status,note,id]);await c.execute('INSERT INTO status_history(report_id,changed_by,status,note) VALUES(?,?,?,?)',[id,me(q).id,status,note]);await c.execute('INSERT INTO notifications(user_id,report_id,message) VALUES(?,?,?)',[r.user_id,id,`Report ${r.tracking_code} status updated to ${status}.`]);await c.commit();s.json({message:'Repair status updated.'});}catch(e){await c.rollback();throw e;}finally{c.release();}
}));
app.get('/api/notifications',auth,route(async(q,s)=>{const [items]=await pool.execute('SELECT n.*,r.tracking_code FROM notifications n LEFT JOIN reports r ON r.id=n.report_id WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 100',[me(q).id]);await pool.execute('UPDATE notifications SET is_read=1 WHERE user_id=?',[me(q).id]);s.json({notifications:items});}));
app.get('/api/admin/staff',roles('admin'),route(async(q,s)=>{const [rows]=await pool.execute("SELECT id,name,username,email,is_active,created_at FROM users WHERE role='repair_staff' ORDER BY name");s.json({staff:rows});}));
app.post('/api/admin/staff',roles('admin'),route(async(q,s)=>{
 const name=String(q.body.name||'').trim(),username=String(q.body.username||'').trim().toLowerCase(),email=String(q.body.email||'').trim().toLowerCase(),password=String(q.body.password||'');
 if(!name||!username||!email||password.length<8)return s.status(400).json({error:'Enter name, username, email and a password of at least 8 characters.'});
 if(!/^[a-z0-9_.-]{3,40}$/.test(username))return s.status(400).json({error:'Username must be 3-40 characters using letters, numbers, dot, underscore or hyphen.'});
 try{await pool.execute("INSERT INTO users(name,username,email,password_hash,role) VALUES(?,?,?,?, 'repair_staff')",[name,username,email,await bcrypt.hash(password,12)]);s.status(201).json({message:'Repairing staff account created. Share the username and password securely with the staff member.'});}
 catch(e){if(e.code==='ER_DUP_ENTRY')return s.status(409).json({error:'That username or email is already in use.'});throw e;}
}));
app.post('/api/setup-admin',route(async(q,s)=>{
 if(process.env.ALLOW_ADMIN_SETUP!=='true')return s.status(403).json({error:'Admin setup disabled. Temporarily set ALLOW_ADMIN_SETUP=true in .env for local setup.'});
 const username=String(q.body.username||'admin').trim().toLowerCase(),email=String(q.body.email||'admin@campusfix.local').trim().toLowerCase(),password=String(q.body.password||'');if(!/^[a-z0-9_.-]{3,40}$/.test(username))return s.status(400).json({error:'Admin username must be 3-40 characters using letters, numbers, dot, underscore or hyphen.'});if(password.length<8)return s.status(400).json({error:'Password must be at least 8 characters.'});
 const [admins]=await pool.execute("SELECT id FROM users WHERE role='admin'");if(admins.length)return s.status(409).json({error:'An administrator account already exists. Only one administrator is allowed.'});
 const [found]=await pool.execute('SELECT id FROM users WHERE email=? OR username=?',[email,username]);if(found.length)return s.status(409).json({error:'Account already exists.'});
 await pool.execute("INSERT INTO users(name,username,email,password_hash,role) VALUES(?,?,?,?,'admin')",['CampusFix Administrator',username,email,await bcrypt.hash(password,12)]);s.status(201).json({message:'Admin created. Set ALLOW_ADMIN_SETUP=false now.'});
}));
app.use('/api',(q,s)=>s.status(404).json({error:'API endpoint not found.'}));
app.use((e,q,s,_n)=>{console.error(e);if(e instanceof multer.MulterError)return s.status(400).json({error:e.code==='LIMIT_FILE_SIZE'?'Photo maximum is 4 MB.':'Photo upload failed.'});if(e.message&&e.message.includes('Only JPG'))return s.status(400).json({error:e.message});s.status(500).json({error:'Server error. Check the VS Code terminal.'});});
(async()=>{try{const c=await pool.getConnection();await c.ping();c.release();app.listen(PORT,()=>console.log(`CampusFix running at http://localhost:${PORT}`));}catch(e){console.error('MySQL connection failed. Check .env and import database.sql:',e.message);process.exit(1);}})();
