import {apiURL} from './runtime.js';

// Images are small raster copies carried in the encrypted lounge event, never
// external URLs that would make every reader contact the article's image host.
export function previewImage(value){
 return typeof value==='string'&&value.length<=33000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)?value:'';
}
export async function fetchPreview(url,signal){
 const target=new URL(url);if(target.username||target.password)return null;
 target.hash=''; // Invitation secrets must never reach the preview helper.
 const response=await fetch(apiURL('preview'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:target.href}),credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal});
 if(!response.ok||response.status===204)return null;
 const text=await response.text();if(text.length>35000)return null;
 const value=JSON.parse(text);
 return {title:typeof value.title==='string'?value.title.slice(0,100):'',thumbnail:previewImage(value.thumbnail)};
}
