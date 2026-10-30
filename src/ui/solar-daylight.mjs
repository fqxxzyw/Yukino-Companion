// NOAA's published fractional-year solar-position approximation. This is an
// offline artistic lighting input, not a navigation or surveying instrument.
// https://gml.noaa.gov/grad/solcalc/solareqns.PDF
const radians=Math.PI/180;
export function validDaylightLocation(value){
 if(!value||typeof value!=='object')return null;
 const {latitude,longitude}=value;
 if(typeof latitude!=='number'||typeof longitude!=='number'||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)return null;
 return {latitude,longitude};
}
export function solarPosition(date,location){
 const coords=validDaylightLocation(location),stamp=date instanceof Date?date.getTime():NaN;
 if(!coords||!Number.isFinite(stamp))return null;
 const year=date.getUTCFullYear(),start=Date.UTC(year,0,1),day=Math.floor((stamp-start)/86400000)+1;
 const leap=year%4===0&&(year%100!==0||year%400===0),yearDays=leap?366:365;
 const hour=date.getUTCHours()+date.getUTCMinutes()/60+(date.getUTCSeconds()+date.getUTCMilliseconds()/1000)/3600;
 const gamma=2*Math.PI/yearDays*(day-1+(hour-12)/24);
 const equation=229.18*(.000075+.001868*Math.cos(gamma)-.032077*Math.sin(gamma)-.014615*Math.cos(2*gamma)-.040849*Math.sin(2*gamma));
 const declination=.006918-.399912*Math.cos(gamma)+.070257*Math.sin(gamma)-.006758*Math.cos(2*gamma)+.000907*Math.sin(2*gamma)-.002697*Math.cos(3*gamma)+.00148*Math.sin(3*gamma);
 const solarMinutes=((hour*60+equation+4*coords.longitude)%1440+1440)%1440;
 const hourAngle=solarMinutes/4-180,lat=coords.latitude*radians,ha=hourAngle*radians;
 const cosine=Math.max(-1,Math.min(1,Math.sin(lat)*Math.sin(declination)+Math.cos(lat)*Math.cos(declination)*Math.cos(ha)));
 return {kind:'solar',elevation:90-Math.acos(cosine)/radians,hourAngle};
}
