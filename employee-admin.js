import {getAuth, onAuthStateChanged, sendPasswordResetEmail} from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-functions.js';
import {getFirestore,collection,getDocs,query,orderBy,limit} from 'https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js';
// Wait for the existing module to initialize the default app.
setTimeout(()=>onAuthStateChanged(getAuth(),async user=>{
 document.querySelector('#accountManagement')?.remove();
 if(!user||(await user.getIdTokenResult()).claims.admin!==true)return;
 const panel=document.createElement('section');panel.id='accountManagement';panel.className='card';
 panel.innerHTML='<h2>Employee accounts</h2><p id="accountTotals"></p><button id="newEmployee" class="btn">Create employee</button><button id="refreshAccounts" class="btn">Refresh accounts and activity</button><div id="accountList"></div><h3>Recent activity (latest 100)</h3><pre id="activityList" style="white-space:pre-wrap"></pre><p id="accountError"></p>';
 document.querySelector('#dashWrap').append(panel);
 const call=httpsCallable(getFunctions(),'manageEmployee');
 const show=e=>panel.querySelector('#accountError').textContent=e.message;
 async function load(){try{
  const s=await getDocs(collection(getFirestore(),'access'));let enabled=0;
  const list=panel.querySelector('#accountList');list.replaceChildren();
  for(const d of s.docs){const x=d.data();if(x.enabled)enabled++;const row=document.createElement('p');row.textContent=`${x.name||d.id} — ${x.email||''} — ${x.enabled?'Active':'Disabled'} `;
   for(const action of ['disable','reset']){const b=document.createElement('button');b.textContent=action==='reset'?'Send password reset':x.enabled?'Disable':'Enable';b.onclick=async()=>{try{const r=await call({action,uid:d.id,enabled:!x.enabled});if(action==='reset')await sendPasswordResetEmail(getAuth(),r.data.email);await load();}catch(e){show(e);}};row.append(b);}list.append(row);}
  panel.querySelector('#accountTotals').textContent=`Registered: ${s.size}; active: ${enabled}; disabled: ${s.size-enabled}`;
  const logs=await getDocs(query(collection(getFirestore(),'adminLogs'),orderBy('at','desc'),limit(100)));
  panel.querySelector('#activityList').textContent=logs.docs.map(d=>{const x=d.data();return `${x.at?.toDate().toISOString()||''} ${x.actor||x.uid||''} ${x.action} ${x.productId||''}`;}).join('\n');
 }catch(e){show(e);}}
 panel.querySelector('#refreshAccounts').onclick=load;
 panel.querySelector('#newEmployee').onclick=async()=>{const email=prompt('Employee email');if(!email)return;const name=prompt('Employee name');if(!name)return;try{await call({action:'create',email,name});await sendPasswordResetEmail(getAuth(),email);await load();}catch(e){show(e);}};
 await load();
}),0);
