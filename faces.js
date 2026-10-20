// Exact rectangle geometry from src/chat_faces.p8, small_face (11 × 11).
// BUDDY's own artwork; ASCII tokens remain interoperable with the retro clients.
export function face(code){
 const ink='#182430',color=code==='A'?'#e16b52':'#f2c83e',rect=(x,y,w,h,c=ink)=>`<rect x="${x+5}" y="${y+5}" width="${w}" height="${h}" fill="${c}"/>`;
 let art=[[-2,-5,5,1],[-4,-4,9,1],[-5,-3,11,7],[-4,4,9,1],[-2,5,5,1]].map(r=>rect(...r)).join('');
 art+=[[-2,-4,5,1],[-3,-3,7,1],[-4,-2,9,5],[-3,3,7,1],[-2,4,5,1]].map(r=>rect(...r,color)).join('');
 const eyes=code==='A'?[[-3,-2,1,1],[-2,-1,1,1],[3,-2,1,1],[2,-1,1,1]]:code==='W'?[[-3,-1,3,1],[2,-1,1,1]]:[[-2,-1,1,1],[2,-1,1,1]];
 const mouth=code==='G'?[[-3,1,7,2]]:['F','A'].includes(code)?[[-1,1,3,1],[-2,2,1,1],[2,2,1,1]]:[[-2,1,1,1],[2,1,1,1],[-1,2,3,1]];
 art+=[...eyes,...mouth].map(r=>rect(...r)).join('');
 return `<svg class="buddy-face" viewBox="0 0 11 11" role="img" aria-label="${{S:'Smile',F:'Frown',W:'Wink',A:'Angry',G:'Grin'}[code]}" shape-rendering="crispEdges">${art}</svg>`;
}
export const facesIn=text=>text.replace(/:([SFWAG]):/g,(_,c)=>face(c));
