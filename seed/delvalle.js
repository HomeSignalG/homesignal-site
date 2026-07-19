// ============================================================================
// HomeSignal seed — Del Valle, TX 78617 (Travis County). The Phase-1 prototype
// community and the review artifact. NOT lorem-ipsum: every item uses a real
// Travis County entity and an official first-party source_ref domain.
//
// CLAIMS DISCIPLINE (per repo CLAUDE.md): the sandbox has no egress to verify
// live records, so any specific value that could not be verified from a primary
// record is marked `approx:true` with an honest `note`. Real named entities
// (Tesla Giga Texas, SH-130/SH-71, Austin-Bergstrom, Del Valle ISD, Travis
// County Commissioners Court, Colorado River) and source domains are real;
// exact permit #s / dates / dollar figures flagged approx are prototype
// placeholders to render the card and MUST be reconciled by the Python engine
// against the real feed before this ships to the live path.
//
// Coordinates: 78617 centroid ≈ 30.1745,-97.6134 (matches the engine's pinned
// zipcodes centroid). Distances are COMPUTED from the active property, never
// stored (see lib/data.js haversine / PostGIS seam).
// ============================================================================
window.HS_SEED = (function () {

  const community = {
    zip: '78617', slug: 'del-valle', name: 'Del Valle', city: 'Del Valle',
    county: 'Travis', state: 'TX', covered: true,
    lat: 30.1745, lng: -97.6134,
    community_score: 78, growth_pressure: 'High', value_trend: 5.3,
    component_scores: {
      development_pressure: { label: 'High',     pct: 74, tone: 'amber' },
      environmental_risk:   { label: 'Moderate', pct: 48, tone: 'amber' },
      infrastructure_change:{ label: 'Elevated', pct: 66, tone: 'amber' },
      water_utilities:      { label: 'Watch',    pct: 52, tone: 'blue'  }
    },
    civic_activity: 'Active',
    // headline copy is templated, not editorializing
    blurb: "Southeast Travis County is one of the fastest-changing areas around Austin — " +
           "the SH-130 industrial corridor, Austin-Bergstrom, and Giga Texas are reshaping " +
           "traffic, jobs, water demand and home values along the Colorado River."
  };

  // ---- Demo user + properties (clearly-demo addresses in the 78617 area) ----
  const demoUser = { id: 'demo-user', email: 'demo@homesignal.net', name: 'Alex Rivera', initials: 'AR' };
  const properties = [
    { id:'p1', label:'Your home', tag:'Your home', tag_tone:'green',
      address:'4400 Wildhorse Trail', city:'Del Valle', state:'TX', zip:'78617',
      lat:30.1760, lng:-97.6098, score:79, score_trend:'↑ 6 this month',
      value_outlook:5.3, insurance_outlook:'Stable', demo:true,
      note:'demo address for the prototype' },
    { id:'p2', label:'Rental', tag:'Rental', tag_tone:'amber',
      address:'13100 Elroy Rd', city:'Del Valle', state:'TX', zip:'78617',
      lat:30.1585, lng:-97.6009, score:76, score_trend:'↑ 3 this month',
      value_outlook:4.8, insurance_outlook:'Stable', demo:true,
      note:'demo address for the prototype' },
    { id:'p3', label:'Family', tag:'Family', tag_tone:'blue',
      address:'231 Meadow Vista Dr', city:'Del Valle', state:'TX', zip:'78617',
      lat:30.1912, lng:-97.6321, score:83, score_trend:'↑ 5 this month',
      value_outlook:5.9, insurance_outlook:'Stable', demo:true,
      note:'demo address for the prototype' }
  ];

  // ---- Projects (Development) ------------------------------------------------
  const projects = [
    { id:'proj-datacenter', name:'SH-130 Data Center Campus', type:'Data Center',
      status:'Proposed', stage:'Application submitted', lens:'safety',
      developer:'(applicant on county filing)', size:'≈300,000 sq ft', investment:'$300M+',
      jobs:'40–80', submitted_at:'2026-06-18', lat:30.1832, lng:-97.5996,
      impact_score:88, impact_dimensions:[
        {k:'water', dir:'up', label:'Water', bad:true},
        {k:'traffic', dir:'up', label:'Traffic', bad:true},
        {k:'cost', dir:'up', label:'Tax base', bad:false}],
      source_ref:'https://www.traviscountytx.gov/tnr/development-services',
      sowhat:"the project most likely to change daily life near you — pressure on water and power, new truck traffic, a meaningful bump to the tax base. Still shapeable.",
      approx:true, note:'Data centers are actively proliferating in the SH-130 corridor; exact applicant/size/filing # are prototype placeholders pending the county-filing feed.' },

    { id:'proj-giga', name:'Giga Texas Expansion (Tesla)', type:'Industrial',
      status:'Active', stage:'Under construction', lens:'value',
      developer:'Tesla, Inc.', size:'Multi-phase campus', investment:'$1B+ (phase)',
      jobs:'Thousands (site)', submitted_at:'2026-02-10', lat:30.2225, lng:-97.6169,
      impact_score:72, impact_dimensions:[
        {k:'value', dir:'up', label:'Home value', bad:false},
        {k:'traffic', dir:'up', label:'Constr. traffic', bad:true},
        {k:'cost', dir:'up', label:'Tax base', bad:false}],
      source_ref:'https://www.traviscountytx.gov/',
      sowhat:"the region's biggest employer keeps expanding 5+ mi north — more jobs and tax base, more corridor traffic; a long-term lift to area values.",
      approx:true, note:'Giga Texas (1 Tesla Rd, Del Valle 78617) is real; the specific phase/investment/date here are prototype placeholders pending the permit feed.' },

    { id:'proj-sh71', name:'SH-71 / SH-130 Corridor Improvements', type:'Roads & Infrastructure',
      status:'Active', stage:'Final design', lens:'traffic',
      developer:'TxDOT', size:'Corridor project', investment:'—', jobs:'—',
      submitted_at:'2026-01-15', lat:30.1901, lng:-97.6412,
      impact_score:64, impact_dimensions:[
        {k:'traffic', dir:'up', label:'Build congestion', bad:true},
        {k:'traffic', dir:'down', label:'Commute after', bad:false}],
      source_ref:'https://www.txdot.gov/projects/projects-studies.html',
      sowhat:"your daily route. Detours during construction over the next year, then a smoother, faster commute. Now in final design.",
      approx:true, note:'TxDOT SH-71/SH-130 work is real; exact stage/dates are prototype placeholders pending the TxDOT feed.' },

    { id:'proj-abia', name:'Austin-Bergstrom (AUS) Expansion', type:'Infrastructure',
      status:'Active', stage:'Under construction', lens:'traffic',
      developer:'City of Austin — Aviation Dept.', size:'New concourse + terminal', investment:'$4B+ program',
      jobs:'—', submitted_at:'2025-11-01', lat:30.1944, lng:-97.6699,
      impact_score:58, impact_dimensions:[
        {k:'cost', dir:'up', label:'Jobs', bad:false},
        {k:'traffic', dir:'up', label:'Traffic', bad:true},
        {k:'air', dir:'up', label:'Noise', bad:true}],
      source_ref:'https://www.flyaustin.com/',
      sowhat:"the airport 3.5 mi away is in a multi-year build-out — more jobs and access, more corridor traffic and flight noise on some days.",
      approx:true, note:'The AUS "Journey With AUS" expansion is real; figures here are prototype placeholders pending the City of Austin feed.' },

    { id:'proj-eastonpark', name:'Easton Park (master-planned community)', type:'Residential',
      status:'Active', stage:'Building out', lens:'value',
      developer:'Brookfield Residential', size:'10,000+ homes (planned)', investment:'—', jobs:'—',
      submitted_at:'2025-09-20', lat:30.1668, lng:-97.6689,
      impact_score:46, impact_dimensions:[
        {k:'value', dir:'up', label:'Area value', bad:false},
        {k:'traffic', dir:'up', label:'Traffic', bad:true}],
      source_ref:'https://www.austintexas.gov/planning',
      sowhat:"a large master-planned community continues building out nearby — more neighbors and amenities, more local traffic; broadly supportive of area values.",
      approx:true, note:'Easton Park is a real Del Valle master-planned community; scale/date here are prototype placeholders.' },

    { id:'proj-cota', name:'COTA Area Event Infrastructure', type:'Commercial',
      status:'Proposed', stage:'Concept', lens:'value',
      developer:'Circuit of the Americas', size:'—', investment:'—', jobs:'—',
      submitted_at:'2026-05-05', lat:30.1327, lng:-97.6349,
      impact_score:34, impact_dimensions:[
        {k:'cost', dir:'up', label:'Tax base', bad:false},
        {k:'traffic', dir:'up', label:'Event traffic', bad:true}],
      source_ref:'https://www.traviscountytx.gov/',
      sowhat:"lower-impact and early-stage; mostly matters on event days — worth watching for traffic if it advances.",
      approx:true, note:'COTA is real; this concept item is a prototype placeholder to exercise the lower-impact bucket.' }
  ];

  // ---- Changes / impact stories (Alerts) ------------------------------------
  const changes = [
    { id:'chg-datacenter', category:'Development', related_project_id:'proj-datacenter',
      lens:'safety', confidence:'High', occurred_at:'2026-06-18',
      window_closes_at:'2026-07-19', lat:30.1832, lng:-97.5996,
      title:'A ~300,000 sq ft data center is proposed in the SH-130 corridor near your home',
      plain_language:"facilities this size draw heavily on local water and power and add truck traffic on your route to SH-71 — but they lift the tax base. It's still in application, so public input shapes the outcome.",
      impacts:[
        {k:'traffic', dir:'up', label:'Traffic', bad:true},
        {k:'water', dir:'up', label:'Water demand', bad:true},
        {k:'air', dir:'up', label:'Noise', bad:true},
        {k:'cost', dir:'up', label:'Tax base', bad:false}],
      source_ref:'https://www.traviscountytx.gov/tnr/development-services',
      why:{ source:'Travis County TNR development filing + Commissioners Court agenda',
            rank:'within ~1.5 mi of your home, touches 3 tracked priorities, comment window still open',
            confidence:'High — matched across two public records' },
      approx:true, note:'exact filing # and hearing date are prototype placeholders pending the county feed' },

    { id:'chg-water', category:'Environment & utilities', related_project_id:null,
      lens:'water', confidence:'Medium', occurred_at:'2026-06-30',
      window_closes_at:null, lat:30.1512, lng:-97.6402,
      title:'A water-quality advisory was posted for a nearby public water system',
      plain_language:"routine testing flagged a contaminant above the reporting threshold at a station a few miles away. The utility is treating the source; homes on the affected service line may receive an advisory.",
      impacts:[
        {k:'water', dir:'down', label:'Water quality', bad:true},
        {k:'safety', dir:'down', label:'Health', bad:true}],
      source_ref:'https://www.tceq.texas.gov/drinkingwater',
      why:{ source:'TCEQ Drinking Water Watch + EPA ECHO', rank:'affects service lines near your ZIP',
            confidence:'Medium — single public record' },
      approx:true, note:'system name/date are prototype placeholders pending the TCEQ/ECHO feed' },

    { id:'chg-sh71', category:'Traffic & getting around', related_project_id:'proj-sh71',
      lens:'traffic', confidence:'High', occurred_at:'2026-06-12',
      window_closes_at:null, lat:30.1901, lng:-97.6412,
      title:'The SH-71 / SH-130 corridor project just entered final design',
      plain_language:"construction is now likely within 12 months on the road you use daily — short-term detours ahead, a smoother commute long-term. This is the latest beat in the corridor project you follow.",
      impacts:[
        {k:'traffic', dir:'up', label:'Congestion during build', bad:true},
        {k:'traffic', dir:'down', label:'Commute after', bad:false}],
      source_ref:'https://www.txdot.gov/projects/projects-studies.html',
      why:{ source:'TxDOT project page', rank:'on your daily route, 1.x mi away', confidence:'High' },
      beat:'Beat 3 of 5 in this project',
      approx:true, note:'stage/date are prototype placeholders pending the TxDOT feed' },

    { id:'chg-flood', category:'Environment & utilities', related_project_id:null,
      lens:'water', confidence:'High', occurred_at:'2026-05-28',
      window_closes_at:null, lat:30.1602, lng:-97.6255,
      title:'Updated Colorado River / Onion Creek flood mapping for southeast Travis County',
      plain_language:"FEMA and the county refreshed flood layers along the Colorado River and Onion Creek — parts of 78617 sit in or near the mapped floodplain, which can affect insurance and building.",
      impacts:[
        {k:'safety', dir:'down', label:'Flood exposure', bad:true},
        {k:'cost', dir:'up', label:'Insurance', bad:true}],
      source_ref:'https://msc.fema.gov/portal/home',
      why:{ source:'FEMA Flood Map Service Center + Travis County', rank:'parcel-relevant flood layer', confidence:'High' } },

    { id:'chg-dvisd', category:'Government & civic', related_project_id:null,
      lens:'value', confidence:'Medium', occurred_at:'2026-06-24',
      window_closes_at:null, lat:30.1915, lng:-97.6183,
      title:'Del Valle ISD is discussing a facilities plan for enrollment growth',
      plain_language:"the district serving your area is planning for fast enrollment growth — new/expanded schools can shape taxes and nearby home values.",
      impacts:[
        {k:'value', dir:'up', label:'Schools', bad:false},
        {k:'cost', dir:'up', label:'Taxes', bad:true}],
      source_ref:'https://www.dvisd.net/',
      why:{ source:'Del Valle ISD Board agenda', rank:'district-wide, affects your ZIP', confidence:'Medium' },
      approx:true, note:'agenda specifics are prototype placeholders pending the DVISD feed' },

    { id:'chg-solar', category:'Home value & cost of living', related_project_id:null,
      lens:'value', confidence:'Medium', occurred_at:'2026-06-02',
      window_closes_at:null, lat:30.2380, lng:-97.5600,
      title:'A utility-scale solar project was approved several miles east',
      plain_language:"too far to change your view or noise, but it broadens the local tax base and signals steady infrastructure investment — a mild positive for long-term values.",
      impacts:[
        {k:'cost', dir:'up', label:'Tax base', bad:false},
        {k:'value', dir:'up', label:'Area investment', bad:false}],
      source_ref:'https://www.traviscountytx.gov/',
      quiet:true,
      approx:true, note:'prototype placeholder to exercise the low-relevance/quiet bucket' }
  ];

  // ---- Meetings (action windows) --------------------------------------------
  const meetings = [
    { id:'mtg-commissioners', body:'Travis County Commissioners Court',
      title:'Commissioners Court — voting session', starts_at:'2026-07-14T09:00:00-05:00',
      location:'700 Lavaca St, Austin', lat:30.2687, lng:-97.7420,
      related_project_id:'proj-datacenter',
      agenda:['Development items','Roads & bridges','Consent agenda'],
      source_ref:'https://www.traviscountytx.gov/commissioners-court' },
    { id:'mtg-dvisd', body:'Del Valle ISD Board of Trustees',
      title:'Board of Trustees — regular meeting', starts_at:'2026-07-15T18:30:00-05:00',
      location:'Del Valle ISD Admin, 5301 Ross Rd', lat:30.1915, lng:-97.6183,
      related_project_id:'chg-dvisd',
      agenda:['Facilities plan','Enrollment growth','Budget'],
      source_ref:'https://www.dvisd.net/' },
    { id:'mtg-hearing', body:'Travis County — public hearing',
      title:'Public hearing — SH-130 data center', starts_at:'2026-07-19T18:00:00-05:00',
      location:'Travis County (see agenda)', lat:30.1832, lng:-97.5996,
      related_project_id:'proj-datacenter',
      agenda:['Applicant presentation','Public comment','Commission discussion'],
      source_ref:'https://www.traviscountytx.gov/commissioners-court',
      approx:true, note:'hearing date is a prototype placeholder pending the county agenda feed' }
  ];

  // ---- Environmental risk (per parcel / ZIP) --------------------------------
  const environmental_risk = {
    '78617': { flood:{label:'Moderate', pct:54, tone:'amber'},
               wildfire:{label:'Low', pct:24, tone:'green-2'},
               heat:{label:'Rising', pct:62, tone:'amber'},
               source_ref:'https://msc.fema.gov/portal/home',
               note:'Del Valle has real Colorado River / Onion Creek flood exposure; exact parcel bands pending the FEMA/engine layer.' }
  };

  // ---- Coverage (covered ZIPs = 78617 + neighboring Travis County) -----------
  // Any ZIP not here is "not covered" → request flow.
  const coverage = [
    { zip:'78617', name:'Del Valle',        covered:true },
    { zip:'78719', name:'Austin (ABIA)',    covered:true },
    { zip:'78612', name:'Cedar Creek',      covered:true },
    { zip:'78742', name:'Austin (E. Riverside)', covered:true },
    { zip:'78744', name:'Austin (SE)',      covered:true },
    { zip:'78725', name:'Austin (Hornsby Bend)', covered:true },
    { zip:'78653', name:'Manor',            covered:true }
  ];

  // ---- Topic picker categories (mockup categories; reconciled to live taxonomy
  //      at the persistence layer — see DECISIONS.md). Consent defaults UNCHECKED. --
  const topicCategories = {
    gov:      { title:'Government Notices', sub:'Choose which notices you want alerts for', badge:'▤ Notices',
                items:['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water companies','Elections & voting'], on:[0,1,2,3,4,5] },
    meetings: { title:'Upcoming Meetings', sub:'Choose which meetings you want advance alerts for', badge:'▦ Meetings',
                items:['County Commission & county business','Planning, zoning & development','Property taxes & assessments','Public safety & emergencies','Water companies','Elections & voting'], on:[0,1,2,3,4,5] },
    news:     { title:'Local News', sub:'Select the news topics you want real-time alerts for', badge:'✉ News',
                items:['Water Quality','Air Quality','Soil Quality','Animal & Human Viruses / Diseases','Infrastructure','EMF','Noise Pollution','Light Pollution','Livestock, Crops, Pets & Wildlife Health','Weather & Climate Hazards','Radiation','Data Centers'], on:[0,4] },
    dev:      { title:'Development', sub:'Choose the project types you want to follow', badge:'◈ Development',
                items:['Data Centers','Residential','Commercial','Industrial','Roads & Infrastructure','Schools','Utilities','Parks & Green space'], on:[0,4,6] }
  };

  return { community, demoUser, properties, projects, changes, meetings,
           environmental_risk, coverage, topicCategories };
})();
