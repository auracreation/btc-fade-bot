import test from 'node:test';
import assert from 'node:assert/strict';
import { BarsState, type Hello, type Batch } from './vendor/makefun-bars.ts';
import { createStrategy } from './strategy.ts';

const hello: Hello = {
  type:'hello',protocol:'agent-fun/bars-replay/v1',seed:'1',bar_interval:'1m',
  first_close_ms:60000,latency_bars:1,
  symbols:[{symbol:'CBBTC',mint:'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',price_scale:5,qty_scale:8}],
  capital:{quote:'USDC',quote_scale:6,quote_units:'1000000000'},
  caps:{max_open_positions:1,max_orders_per_bar:16,max_weight_bps:10000,shorts:false,leverage:false},
  fees:{fee_bps:4,slippage_bps:2,min_notional_quote_units:'1000000'},
};
function fixture(overrides: Partial<Hello>={}) {
  const state=new BarsState({...hello,...overrides}),decide=createStrategy();
  function tick(seq:number,price=1000,held=false,options:{fresh?:boolean,buyFill?:boolean,cash?:string}={}) {
    const raw=String(Math.round(price*100000)),t=(seq+1)*60000;
    const b:Batch={type:'batch',seq,t,
      bars:options.fresh===false?[]:[{symbol:'CBBTC',t,o:raw,h:raw,l:raw,c:raw,v:null,o_depth:['800000000000'],c_depth:['800000000000']}],
      fills:options.buyFill?[{client_id:'buy',symbol:'CBBTC',side:'buy',status:'filled',reason:null,
        decided_bar:t-60000,fill_bar:t,price:raw,qty:'100000000',notional_quote_units:'1000000000',fee_quote_units:'400000'}]:[],
      account:{cash_quote_units:options.cash??(held?'0':'1000000000'),
        equity_quote_units:held?String(Math.round(price*1000000)):(options.cash??'1000000000'),
        positions:held?[{symbol:'CBBTC',qty:'100000000',cost_quote_units:'1000000000'}]:[]}};
    state.applyBatch(b);
    return state.toOrders(decide(state,b));
  }
  return {state,tick};
}

test('the 180 bps target sells a position worth 101.8% of its cost',()=>{
  const order=fixture().tick(0,1018,true)[0];
  assert.equal(order?.side,'sell');
  assert.equal(order.max_slippage_bps,150);
});
test('the 100 bps stop sells at 99% of cost',()=>{
  const order=fixture().tick(0,990,true)[0];
  assert.equal(order?.side,'sell');
  assert.equal(order.max_slippage_bps,10000);
});
test('a position between target and stop stays open',()=>{
  assert.deepEqual(fixture().tick(0,1005,true),[]);
});
test('a recovery exit waits 180 bars after the actual buy fill',()=>{
  const f=fixture();
  for(let i=0;i<70;i++)f.tick(i);
  f.tick(70,1000,true,{buyFill:true});
  for(let i=71;i<100;i++)f.tick(i,1000,true);
  assert.deepEqual(f.tick(100,1012,true),[]);
  for(let i=101;i<250;i++)f.tick(i,1000,true);
  assert.equal(f.tick(250,1012,true)[0]?.side,'sell');
});
test('a failed fade exits after 480 bars even without a target or recovery',()=>{
  const f=fixture();f.tick(0,1000,true,{buyFill:true});
  for(let i=1;i<480;i++)assert.deepEqual(f.tick(i,1000,true),[]);
  assert.equal(f.tick(480,1000,true)[0]?.side,'sell');
});
test('the 2% equity breaker remains stopped after liquidation',()=>{
  const f=fixture();f.tick(0);
  assert.equal(f.tick(1,979,true)[0]?.side,'sell');
  for(let i=2;i<122;i++)f.tick(i,1000,false,{cash:'979000000'});
  assert.deepEqual(f.tick(1200,1000,false,{cash:'979000000'}),[]);
});
test('the equity breaker also latches at exactly a 2% loss',()=>{
  const f=fixture();f.tick(0);
  f.tick(1,980,true);
  for(let i=2;i<122;i++)f.tick(i,1000,false,{cash:'980000000'});
  assert.deepEqual(f.tick(1200,1000,false,{cash:'980000000'}),[]);
});
test('late participation uses 1% of cash rather than full exposure',()=>{
  const f=fixture();for(let i=0;i<121;i++)f.tick(i);
  const orders=f.tick(1200);
  assert.equal(orders.length,1);
  assert.equal(orders[0].side,'buy');
  assert.equal('notional_quote_units' in orders[0]?orders[0].notional_quote_units:undefined,'10000000');
});
test('missing bars do not trigger fresh entries, including participation',()=>{
  const f=fixture();for(let i=0;i<121;i++)f.tick(i);
  assert.deepEqual(f.tick(1200,1000,false,{fresh:false}),[]);
});
test('warmup batches collect history but never trade',()=>{
  const f=fixture({warmup_bars:1300});
  for(let i=0;i<121;i++)f.tick(i);
  assert.deepEqual(f.tick(1200),[]);
});
test('no entry is opened after the entry cutoff',()=>{
  const f=fixture();for(let i=0;i<121;i++)f.tick(i);
  assert.deepEqual(f.tick(1421),[]);
});
test('a strategy instance has independent state and deterministic decisions',()=>{
  const a=fixture(),b=fixture({seed:'999'});
  for(let i=0;i<=1200;i++)assert.deepEqual(a.tick(i,1000),b.tick(i,1000));
});
test('a full-size signal requires all 120 bars of trend context',()=>{
  const f=fixture();
  for(let i=0;i<45;i++)f.tick(i);
  for(let i=45;i<60;i++)f.tick(i,988);
  assert.deepEqual(f.tick(60,988),[]);
});
test('participation and entry cutoff are relative to the scored window after warmup',()=>{
  const f=fixture({warmup_bars:1440});
  for(let i=0;i<1440;i++)assert.deepEqual(f.tick(i),[]);
  const orders=f.tick(2640);
  assert.equal(orders[0]?.side,'buy');
  assert.equal('notional_quote_units' in orders[0]?orders[0].notional_quote_units:undefined,'10000000');
});
