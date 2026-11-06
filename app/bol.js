/* Toymover unsigned BOL. Local jsPDF only; explicit nonfinancial field allowlist.
 * Mirrors /workspace/bol/make_bol.py. No notes, amounts or pay. Auction lot / pickup PIN only when supplied by the authorized job RPC.
 * No storage write: signed BOL records and published static PDFs stay untouched. */
(function (root) {
  'use strict';
  function clean(value) {
    var s = String(value == null ? '' : value).trim();
    // Fail closed if a nominally descriptive field has financial text (pickup PINs are explicitly allowed).
    if (/[$\u00a3\u20ac]|\b(?:USD|price|broker|fee|invoice|payment|pay|passcode|password)\b|(?:\/|per\s*)\s*(?:mi(?:le)?s?)\b/i.test(s)) return '';
    return /^(?:TBD|N\/A|NONE|NONE ON FILE)$/i.test(s) ? '' : s.replace(/[^\x20-\x7e\n]/g, ' ').slice(0, 1500);
  }
  function fields(j, driver, auction) {
    auction = auction || j;
    // Do not serialize or spread a job: supervisor RPCs also carry sensitive fields.
    return {
      id: clean(j.id), pickupDate: clean(j.production_week), deliveryDate: clean(j.delivery_week),
      shipper: clean(j.pickup_name), pickupAddress: clean(j.pickup_address), pickupPhone: clean(j.pickup_phone),
      consignee: clean(j.delivery_customer), deliveryAddress: clean(j.delivery_address),
      deliveryPhone: clean(j.delivery_phone) || clean(j.contact_phone),
      description: clean(j.item_type), category: clean(j.item_category), driver: clean(driver),
      auctionLot: clean(auction.auction_lot), pickupPin: clean(auction.pickup_pin)
    };
  }
  function week(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    var p = s.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
    return 'Week of ' + d.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
  }
  function build(j, driver, offline, auction) {
    if (!root.jspdf || !root.jspdf.jsPDF) throw new Error('PDF library unavailable. Reload the app online once.');
    var f = fields(j, driver, auction), doc = new root.jspdf.jsPDF({unit:'pt', format:'letter', compress:true});
    var left = 29, width = 554, y = 94;
    doc.setProperties({title:'Bill of Lading ' + f.id, author:'Fisher Transport LLC dba Toymover'});
    doc.setLineWidth(0.6); doc.setDrawColor(51); doc.setTextColor(17);
    function title() {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text('BILL OF LADING', 306, 44, {align:'center'});
      doc.setFontSize(10); doc.text('Fisher Transport LLC dba Toymover',306,61,{align:'center'});
      doc.setFont('helvetica','normal'); doc.text('Coppell, TX | toymover@gmail.com',306,75,{align:'center'});
    }
    function room(h) {
      if (y + h > 742) { doc.addPage(); title(); y=94; }
    }
    function table(headers, values, ratios, minHeight) {
      doc.setFont('helvetica','normal'); doc.setFontSize(9);
      var widths=ratios.map(function(r){return width*r;}), lines=values.map(function(v,i){return doc.splitTextToSize(v || '________________',widths[i]-12);});
      var heads=headers.map(function(v,i){return doc.splitTextToSize(v,widths[i]-12);});
      var hh=Math.max.apply(null,heads.map(function(l){return l.length;}))*11+10;
      var h=Math.max(minHeight || 28,Math.max.apply(null,lines.map(function(l){return l.length;}))*11+12);
      room(h+hh+8); var x=left;
      headers.forEach(function(v,i){
        doc.setFillColor(232,238,245); doc.rect(x,y,widths[i],hh,'FD');
        doc.setFont('helvetica','bold'); doc.text(heads[i],x+6,y+13,{lineHeightFactor:1.2});
        doc.rect(x,y+hh,widths[i],h); doc.setFont('helvetica','normal'); doc.text(lines[i],x+6,y+hh+14,{lineHeightFactor:1.2}); x+=widths[i];
      }); y+=hh+h+7;
    }
    title();
    table(['BOL Number','Pickup date','Delivery date','Truck / Trailer No.'],[f.id,week(f.pickupDate),week(f.deliveryDate),''],[0.16,0.28,0.28,0.28]);
    function party(name,addr,phone){return [name || '________________',addr || '________________','Phone: '+(phone || '________________')].join('\n');}
    table(['Shipper (Pickup)','Consignee (Delivery)'],[party(f.shipper,f.pickupAddress,f.pickupPhone) + (f.auctionLot ? '\nAuction lot / Stock #: ' + f.auctionLot : '') + (f.pickupPin ? '\nPickup PIN: ' + f.pickupPin : ''),party(f.consignee,f.deliveryAddress,f.deliveryPhone)],[0.5,0.5],67);
    table(['Carrier','Driver'],['Fisher Transport LLC dba Toymover, Coppell, TX',f.driver],[0.5,0.5]);
    // VIN/dimensions/weight are intentionally blank: the driver RPC does not expose verified fields.
    table(['Qty','Unit description (year / make / model)','Type','VIN','Dimensions','Weight'],['1',f.description,f.category,'','',''],[0.055,0.365,0.16,0.15,0.15,0.12],38);
    table(['Condition / damage notes at pickup','Condition / damage notes at delivery'],[' ',' '],[0.5,0.5],(f.auctionLot || f.pickupPin) ? 55 : 83);
    room(42); doc.setFontSize(9); doc.text(doc.splitTextToSize('Received in apparent good order and condition, except as noted above. The carrier certifies that the unit described was properly secured for transport.',width),left,y+9); y+=34;
    var sig='\nSignature: __________________________\n\nPrinted name: _______________________\n\nDate: ______________________________';
    table(['Shipper at pickup','Consignee at delivery'],[sig,sig],[0.5,0.5],92);
    table(['Driver'],['Signature: ____________________    Printed name: ____________________    Date: ______________'],[1],32);
    room(25); doc.setFontSize(8); doc.text('Customer signature optional. Regenerated unsigned copy; existing signed BOLs are unchanged.',left,y+7);
    doc.text('Generated '+new Date().toLocaleString('en-US',{timeZone:'America/Los_Angeles'})+' Pacific Time'+(offline?' - OFFLINE: last loaded job data':''),left,y+20);
    return doc;
  }
  root.ToymoverBOL={build:build, fields:fields, clean:clean};
})(typeof window !== 'undefined' ? window : globalThis);
