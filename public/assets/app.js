const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const msg=(t,type='error')=>{const e=$('#message');if(e)e.innerHTML=`<div class="alert ${type}">${esc(t)}</div>`};
async function api(url,opt={}){const r=await fetch(url,{credentials:'same-origin',...opt});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Request failed');return d}
const date=v=>v?new Date(v).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}):'';
const badge=s=>`<span class="status-pill ${String(s).toLowerCase().replaceAll(' ','-')}">${esc(s)}</span>`;
const priority=p=>`<span class="priority ${esc(p)}">${esc(p[0].toUpperCase()+p.slice(1))}</span>`;
document.addEventListener('click',async e=>{if(e.target.closest('[data-logout]')){e.preventDefault();try{await api('/api/logout',{method:'POST'});location.href='/'}catch(x){alert(x.message)}}});
document.addEventListener('DOMContentLoaded',async()=>{
 let user=null;try{user=(await api('/api/me')).user}catch{}
 
const lf = $('#loginForm');

if (lf) {
    lf.onsubmit = async e => {
        e.preventDefault();

        try {
            const d = await api('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    Object.fromEntries(new FormData(lf))
                )
            });

            if (!d.user || !d.user.role) {
                throw new Error('Login succeeded, but the user role was not returned.');
            }

            msg(d.message, 'success');

            setTimeout(() => {
                location.href = '/dashboard.html';
            }, 500);

        } catch (x) {
            msg(x.message);
        }
    };
}

 const rf=$('#registerForm');if(rf)rf.onsubmit=async e=>{e.preventDefault();try{let d=await api('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(rf)))});msg(d.message,'success');setTimeout(()=>location.href='/login.html',800)}catch(x){msg(x.message)}};
 const form=$('#reportForm');if(form){if(!user){msg('Please sign in first.');setTimeout(()=>location.href='/login.html',800)}form.onsubmit=async e=>{e.preventDefault();try{let d=await api('/api/reports',{method:'POST',body:new FormData(form)});msg(d.message,'success');setTimeout(()=>location.href='/report-view.html?id='+d.id,700)}catch(x){msg(x.message)}}}
 if($('#stats'))loadDash(user);if(user&&user.role==='admin')initStaffManager();if($('#detailArea'))loadDetails(user);if($('#notificationsArea'))loadNotifications(user);
});
async function loadDash(user){if(!user){location.href='/login.html';return}try{let d=await api('/api/reports');$('#roleLabel').textContent=d.role.replaceAll('_',' ')+' WORKSPACE';if(!['student','faculty'].includes(d.role))$('#reportBtn').hidden=true;$('#reportHeading').textContent=d.role==='admin'?'All campus reports':d.role==='repair_staff'?'Reports to repair':'Your reports';$('#reportCount').textContent=d.reports.length+' record(s)';$('#stats').innerHTML=Object.entries(d.counts).map(([k,v])=>`<div class="stat-card"><span>${esc(k)}</span><strong>${Number(v)}</strong></div>`).join('');if(!d.reports.length){$('#reportsArea').innerHTML='<div class="empty-state"><h3>Nothing here yet</h3><p>Submitted reports will appear here.</p></div>';return}$('#reportsArea').innerHTML=`<div class="table-wrap"><table><thead><tr><th>Tracking ID</th><th>Fault</th><th>Location</th><th>Priority</th><th>Status</th><th>Reported</th><th></th></tr></thead><tbody>${d.reports.map(r=>`<tr><td class="ticket-code">${esc(r.tracking_code)}</td><td><strong>${esc(r.title)}</strong><small>${esc(r.category)}${d.role==='admin'?' · by '+esc(r.reporter):''}</small></td><td>${esc(r.department)}<small>${esc(r.location)}</small></td><td>${priority(r.priority)}</td><td>${badge(r.status)}</td><td>${esc(new Date(r.created_at).toLocaleDateString())}</td><td><a class="table-link" href="/report-view.html?id=${r.id}">Open →</a></td></tr>`).join('')}</tbody></table></div>`}catch(e){msg(e.message)}}
async function loadDetails(user){if(!user){location.href='/login.html';return}let id=new URLSearchParams(location.search).get('id');try{let d=await api('/api/reports/'+encodeURIComponent(id)),r=d.report;let timeline=d.history.map(h=>`<div class="timeline-item"><span class="timeline-dot"></span><div><strong>${esc(h.status)}</strong><p>${esc(h.note||'Status updated.')}</p><small>${esc(h.actor||'System')} · ${esc(date(h.created_at))}</small></div></div>`).join('');let action='';
if(d.role==='admin'&&!['Completed','Declined'].includes(r.status))action=`<section class="panel action-panel"><h2>Administrator action</h2><form id="adminForm" class="stack-form"><label>Action<select name="action" id="action"><option value="accept">Accept report</option><option value="decline">Decline report</option></select></label><div id="assignStaff"><label>Assign repairing staff<select name="staff_id" id="staffSelect" required><option value="">Loading staff...</option></select></label></div><div id="days"><label>Estimated repair days<input type="number" name="expected_days" min="1" max="365" value="${r.expected_days||3}"></label></div><label>Note / reason<textarea name="reason" rows="3"></textarea></label><button class="button primary">Save decision</button></form></section>`;
if(d.role==='repair_staff'&&['Accepted','In Progress'].includes(r.status))action=`<section class="panel action-panel"><h2>Repair update</h2><form id="staffForm" class="stack-form"><label>Status<select name="status"><option>In Progress</option><option>Completed</option></select></label><label>Work note<textarea name="note" rows="3" required></textarea></label><button class="button primary">Update repair status</button></form></section>`;
$('#detailArea').innerHTML=`<div class="page-heading heading-row"><div><a class="back-link" href="/dashboard.html">← Dashboard</a><span class="eyebrow">${esc(r.tracking_code)}</span><h1>${esc(r.title)}</h1><p>Submitted ${esc(date(r.created_at))}</p></div>${badge(r.status)}</div><div class="detail-grid"><section class="panel"><div class="detail-pair"><span>Category</span><strong>${esc(r.category)}</strong></div><div class="detail-pair"><span>Department</span><strong>${esc(r.department)}</strong></div><div class="detail-pair"><span>Location</span><strong>${esc(r.location)}</strong></div><div class="detail-pair"><span>Priority</span><strong>${priority(r.priority)}</strong></div><div class="detail-pair"><span>Reporter</span><strong>${esc(r.reporter)} (${esc(r.reporter_email)})</strong></div><div class="description-block"><h3>Description</h3><p>${esc(r.description).replaceAll('\\n','<br>')}</p></div>${r.photo_path?`<h3>Attached photo</h3><img class="report-photo" src="${esc(r.photo_path)}" alt="Fault photo">`:''}${r.admin_reason?`<div class="form-note"><strong>Admin note:</strong> ${esc(r.admin_reason)}</div>`:''}${r.expected_days?`<div class="form-note"><strong>Estimated repair time:</strong> ${r.expected_days} day(s)</div>`:''}${r.completion_note?`<div class="form-note"><strong>Repair update:</strong> ${esc(r.completion_note)}</div>`:''}</section><aside class="panel"><h2>Activity timeline</h2><div class="timeline">${timeline}</div></aside></div>${action}`;
const af=$('#adminForm');if(af){const ac=$('#action'),days=$('#days'),assign=$('#assignStaff'),staffSelect=$('#staffSelect');const upd=()=>{days.hidden=ac.value==='decline';assign.hidden=ac.value==='decline';staffSelect.required=ac.value==='accept'};ac.onchange=upd;upd();api('/api/admin/staff').then(x=>{staffSelect.innerHTML='<option value="">Choose staff</option>'+x.staff.filter(t=>t.is_active).map(t=>`<option value="${t.id}">${esc(t.name)} (@${esc(t.username)})</option>`).join('');if(!x.staff.length)staffSelect.innerHTML='<option value="">Create a staff account on dashboard first</option>'}).catch(e=>{staffSelect.innerHTML='<option value="">'+esc(e.message)+'</option>'});af.onsubmit=async e=>{e.preventDefault();try{let out=await api('/api/reports/'+id+'/admin-action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(af)))});msg(out.message,'success');setTimeout(()=>location.reload(),500)}catch(x){msg(x.message)}}}
const sf=$('#staffForm');if(sf)sf.onsubmit=async e=>{e.preventDefault();try{let out=await api('/api/reports/'+id+'/staff-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(sf)))});msg(out.message,'success');setTimeout(()=>location.reload(),500)}catch(x){msg(x.message)}}
}catch(e){$('#detailArea').innerHTML=`<div class="alert error">${esc(e.message)}</div>`}}
async function loadNotifications(user){if(!user){location.href='/login.html';return}try{let d=await api('/api/notifications');if(!d.notifications.length){$('#notificationsArea').innerHTML='<div class="empty-state"><h3>You are all caught up</h3><p>New updates will appear here.</p></div>';return}$('#notificationsArea').innerHTML=`<div class="notification-list">${d.notifications.map(n=>`<a class="notification-item" href="${n.report_id?'/report-view.html?id='+n.report_id:'#'}"><span class="notification-icon">↗</span><div><p>${esc(n.message)}</p><small>${esc(date(n.created_at))} ${n.tracking_code?'· '+esc(n.tracking_code):''}</small></div></a>`).join('')}</div>`}catch(e){msg(e.message)}}

async function initStaffManager(){const panel=$('#staffManager');if(!panel)return;panel.hidden=false;const form=$('#staffFormCreate');form.onsubmit=async e=>{e.preventDefault();try{const d=await api('/api/admin/staff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(form)))});msg(d.message,'success');form.reset();await refreshStaff()}catch(x){msg(x.message)}};async function refreshStaff(){try{const d=await api('/api/admin/staff');$('#staffList').innerHTML='<h3>Repairing staff accounts</h3>'+(d.staff.length?'<div class="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Status</th></tr></thead><tbody>'+d.staff.map(t=>`<tr><td>${esc(t.name)}</td><td>${esc(t.username)}</td><td>${esc(t.email)}</td><td>${t.is_active?'Active':'Inactive'}</td></tr>`).join('')+'</tbody></table></div>':'<p>No staff accounts created yet.</p>')}catch(e){$('#staffList').textContent=e.message}}await refreshStaff()}
