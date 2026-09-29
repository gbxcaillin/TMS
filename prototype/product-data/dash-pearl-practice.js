// Copied from brightly-live.html (live-core section)
const PRACTICE={adviser:'Scott Brouwer',arNo:'283906',firm:'Brightday Australia Pty Ltd',car:'1313063',licensee:'Banyan Securities Pty Ltd',afsl:'484139',address:'4 Sycamore Street, Box Hill South VIC 3128',phone:'+61 3 9595 3855',email:'clientservices@brightday.com.au',abn:'79 609 452 226',pearlFamily:'Pearl Lite',
  upfrontPct:.033,upfrontCap:4950,ongoingPct:.011,ongoingCap:10000};
/* DASH and Pearl fee data from the fee-comparison building block. Marked unverified there: check against the current PDS. */
const DASHP={
  super:{name:'DASH Super Simplifier',tiers:[[500000,.00352],[1e12,0]],cap:null,er:.0003,asAt:'18 Dec 2024',src:'Super Simplifier PDS, 18 December 2024, Section 6'},
  wealth:{name:'DASH Wealth Simplifier',tiers:[[2000000,.00165],[1e12,0]],cap:3000,er:0,asAt:'1 Jul 2025',src:'Wealth Simplifier PDS, 1 July 2025, s.11 (Brightday-negotiated concessions)'},
  mda:{name:'DASH Investment Services',admin:120,provider:.0003,src:'DASH Managed Account Service, Schedule 2'},
  pearlAsAt:'31 May 2026',pearlSrc:'Pearl fact sheets'};
const PEARLP=[["Pearl X Conservative",.0055,.0042,1,.001009,.000013],["Pearl X Moderate",.0055,.004,1,.00102,.000013],["Pearl X Balanced",.0055,.004,1,.001038,.000017],["Pearl X Growth",.0055,.0039,1,.001038,.00002],["Pearl X High Growth",.0055,.004,1,.000999,.000133],["Pearl X High Conviction",.0055,.0044,1,.000926,.000402],
  ["Pearl Plus Conservative",.0077,.0038,1,.001009,.000013],["Pearl Plus Moderate",.0077,.0034,1,.00102,.000013],["Pearl Plus Balanced",.0077,.0032,1,.001038,.000017],["Pearl Plus Growth",.0077,.0029,1,.001038,.00002],["Pearl Plus High Growth",.0077,.0028,1,.000999,.000133],
  ["Pearl Lite Conservative",.003,.003,0,.001009,.000013],["Pearl Lite Moderate",.003,.003,0,.00102,.000013],["Pearl Lite Balanced",.003,.003,0,.001038,.000017],["Pearl Lite Growth",.003,.0029,0,.001038,.00002],["Pearl Lite High Growth",.003,.0031,0,.000999,.000133],["Pearl Lite High Conviction",.003,.0036,0,.000926,.000402],
  ["Pearl Lite ESG Moderate",.0055,.0036,0,.00102,.000013],["Pearl Lite ESG Balanced",.0055,.0039,0,.001038,.000017],["Pearl Lite ESG Growth",.0055,.0044,0,.001038,.00002],["Pearl Lite ESG High Growth",.0055,.0047,0,.000999,.000133]]
  .map(([name,mgmt,icr,op,brok,bs])=>({name,mgmt,icr,op:!!op,brok,bs}));
const REBALANCE_PCT=.0011; // Pearl Lite: transaction cost on the amount traded at each rebalance
const isMDA=port=>!!(port&&port.op);
