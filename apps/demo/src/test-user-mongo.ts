import { MongoPlugin } from '@synapsedb/plugin-mongodb';
const log = { debug: ()=>{}, info: ()=>{}, warn: ()=>{}, error: ()=>{} };
async function go() {
  console.log('\n🧑‍💻 Developer Test: SynapseDB MongoDB Plugin\n');
  const m = new MongoPlugin({});
  try {
    await m.connect({ connectionUri: 'mongodb://localhost:27017/synapsetest' }, log);
  } catch (e) {
    console.log('MongoDB not running, skipping test');
    process.exit(0);
  }
  
  console.log('✅ Connected to MongoDB');
  const h = await m.healthCheck();
  console.log('✅ Health:', JSON.stringify(h));
  await m.syncSchema({ name: 'blog_posts', fields: { id: { type: 'uuid', primary: true }, title: { type: 'string' }, views: { type: 'integer' } } }, ['id','title','views']);
  console.log('✅ Schema synced');
  const ins = await m.insert('blog_posts', [
    { id: 'p1', title: 'Hello SynapseDB', views: 0 },
    { id: 'p2', title: 'Polyglot Data', views: 10 },
  ], ['id','title','views']);
  console.log('✅ Inserted', ins.insertedCount, 'docs');
  const found = await m.find('blog_posts', { type:'FIND', collection:'blog_posts', filters: null }, ['id','title','views']);
  console.log('✅ Found', found.length, 'docs');
  found.forEach(d => console.log('  •', d.title, '- views:', d.views));
  const one = await m.findOne('blog_posts', { type:'FIND', collection:'blog_posts', filters: { logic:'AND', conditions:[{field:'id',op:'EQ',value:'p1'}] } }, ['id','title','views']);
  console.log('✅ FindOne:', one?.title);
  await m.update('blog_posts', { type:'UPDATE', collection:'blog_posts', filters: { logic:'AND', conditions:[{field:'id',op:'EQ',value:'p1'}] } }, { views: 999 }, ['id','title','views']);
  const after = await m.findOne('blog_posts', { type:'FIND', collection:'blog_posts', filters: { logic:'AND', conditions:[{field:'id',op:'EQ',value:'p1'}] } }, ['id','title','views']);
  console.log('✅ Updated:', after?.title, '→ views:', after?.views);
  await m.delete('blog_posts', { type:'DELETE', collection:'blog_posts', filters: { logic:'AND', conditions:[{field:'id',op:'EQ',value:'p2'}] } });
  console.log('✅ Deleted p2');
  const rem = await m.find('blog_posts', { type:'FIND', collection:'blog_posts', filters: null }, ['id','title','views']);
  console.log('✅ Remaining:', rem.length, 'docs');
  // cleanup
  await m.delete('blog_posts', { type:'DELETE', collection:'blog_posts', filters: { logic:'AND', conditions:[{field:'id',op:'EQ',value:'p1'}] } });
  await m.disconnect();
  console.log('\n✨ Full CRUD lifecycle passed!\n');
}
go().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
