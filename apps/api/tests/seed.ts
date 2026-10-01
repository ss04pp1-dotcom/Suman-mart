// Seed SQL for the API integration tests — applied after the real wrangler
// migrations (see tests/setup.ts). Deliberately small and varied enough to
// exercise every public endpoint's semantics: filters, sorts, pagination,
// active/inactive rows, manual + auto recommendations, approved/pending
// reviews, phone-matched order tracking.

export const SEED_SQL = `
-- Categories ------------------------------------------------------------
INSERT INTO Category ("id","name","slug","description","imageUrl","sortOrder","isActive") VALUES
 ('cat-electronics','Electronics','electronics','Gadgets','/categories/electronics-1.jpg',1,1),
 ('cat-fashion','Fashion','fashion','Apparel','/categories/fashion-1.jpg',2,1),
 ('cat-home','Home & Living','home-living','Home','/categories/home-living-1.jpg',3,1),
 ('cat-archived','Archived','archived','Gone','/x.jpg',4,0);

-- Tags -------------------------------------------------------------------
INSERT INTO Tag ("id","name","slug") VALUES
 ('tag-wireless','Wireless','wireless'),
 ('tag-eco','Eco','eco');

-- Products (p1..p6 active, p7 INACTIVE) ----------------------------------
INSERT INTO Product
 ("id","name","slug","shortDescription","description","price","compareAtPrice","sku","stock","isActive","isFeatured","brand","rating","reviewCount","soldCount","categoryId","createdAt","updatedAt") VALUES
 ('p1','Wireless Earbuds Pro','wireless-earbuds-pro','Great sound','Long description of earbuds',2500,3500,'SKU-1',10,1,1,'Acme',4.5,10,100,'cat-electronics','2026-01-01 00:00:00','2026-01-02 00:00:00'),
 ('p2','Fast Charger 30W','fast-charger','Quick charge','Desc',1200,NULL,'SKU-2',0,1,0,'Acme',4.0,5,200,'cat-electronics','2026-01-03 00:00:00','2026-01-04 00:00:00'),
 ('p3','Cotton T-Shirt','cotton-tshirt','Soft tee','Desc',800,1000,'SKU-3',50,1,0,'BdWear',4.8,20,300,'cat-fashion','2026-01-05 00:00:00','2026-01-06 00:00:00'),
 ('p4','Denim Jacket','denim-jacket','Stylish','Desc',3200,NULL,'SKU-4',5,1,0,'BdWear',4.2,8,40,'cat-fashion','2026-01-07 00:00:00','2026-01-08 00:00:00'),
 ('p5','Table Lamp','table-lamp','Warm light','Desc',1500,1800,'SKU-5',25,1,0,'HomeCo',3.9,4,10,'cat-home','2026-01-09 00:00:00','2026-01-10 00:00:00'),
 ('p6','Scented Candle','scented-candle','Lavender','Desc',700,NULL,'SKU-6',100,1,0,'HomeCo',4.1,6,60,'cat-home','2026-01-11 00:00:00','2026-01-12 00:00:00'),
 ('p7','Old Product','old-product','Inactive','Desc',999,NULL,'SKU-7',10,0,0,'Acme',1.0,0,0,'cat-electronics','2026-01-13 00:00:00','2026-01-14 00:00:00'),
 ('p8','USB-C Hub 7-in-1','usb-c-hub','More ports','Desc',2000,2400,'SKU-8',15,1,0,'Acme',4.4,7,5,'cat-electronics','2026-01-15 00:00:00','2026-01-16 00:00:00');

-- Product images (sortOrder matters: first = imageUrl, second = hover) ----
INSERT INTO ProductImage ("id","productId","url","alt","sortOrder") VALUES
 ('img1','p1','/products/earbuds-1.jpg','Earbuds',0),
 ('img2','p1','/products/earbuds-2.jpg','Earbuds alt',1),
 ('img3','p2','/products/charger.jpg','Charger',0),
 ('img4','p3','/products/tshirt.jpg','Tee',0),
 ('img5','p4','/products/jacket.jpg','Jacket',0),
 ('img6','p5','/products/lamp.jpg','Lamp',0),
 ('img7','p6','/products/candle.jpg','Candle',0),
 ('img8','p8','/products/hub.jpg','Hub',0);

-- Variants (options is a JSON string, exactly as Prisma stores it) --------
INSERT INTO ProductVariant ("id","productId","name","options","sku","price","stock","sortOrder") VALUES
 ('v1','p1','Black','{"Color":"Black"}','VAR-1',2600,4,0),
 ('v2','p1','White','{"Color":"White"}','VAR-2',2500,6,1);

-- Tag links ---------------------------------------------------------------
INSERT INTO ProductTag ("productId","tagId") VALUES
 ('p1','tag-wireless'),('p2','tag-wireless'),('p3','tag-eco'),('p6','tag-eco');

-- Reviews (r1 APPROVED, r2 PENDING, r3 APPROVED featured) -----------------
INSERT INTO Review ("id","productId","authorName","rating","title","comment","status","isFeatured","adminReply","createdAt") VALUES
 ('r1','p1','Rafiq',5,'Excellent','Loved it','APPROVED',0,NULL,'2026-02-01 00:00:00'),
 ('r2','p1','Hidden',1,'Pending','Not shown yet','PENDING',0,NULL,'2026-02-02 00:00:00'),
 ('r3','p1','Karim',4,'Very good','Solid product','APPROVED',1,'Thanks for the review!','2026-02-03 00:00:00');

-- Manual relations: RELATED p2→p1, FBT p3→p1 ------------------------------
INSERT INTO ProductRelation ("id","productId","relatedProductId","type","sortOrder") VALUES
 ('rel1','p1','p2','RELATED',0),
 ('rel2','p1','p3','FBT',0),
 ('rel3','p1','p4','FBT',1);

-- Settings (general overrides store name only; payment/shipping defaults) -
INSERT INTO Setting ("key","value","updatedAt") VALUES
 ('general','{"storeName":"Suman Mart","supportPhone":"+880 1700-111111"}','2026-03-01 00:00:00'),
 ('payment','{"codEnabled":true,"bkashEnabled":true,"bkashNumber":"01700-000001","nagadEnabled":false,"nagadNumber":"","cardEnabled":false}','2026-03-01 00:00:00');

-- Tracking integrations (META on, GOOGLE off, TIKTOK on but unconfigured) -
INSERT INTO TrackingIntegration ("id","provider","config","secrets","isEnabled","updatedAt") VALUES
 ('ti1','META','{"pixelId":"1234567890"}','{"capiToken":"SECRET"}',1,'2026-03-01 00:00:00'),
 ('ti2','GOOGLE','{"ga4MeasurementId":"G-XXX","gtmId":""}','{}',0,'2026-03-01 00:00:00'),
 ('ti3','TIKTOK','{"pixelId":""}','{}',1,'2026-03-01 00:00:00');

-- Orders -------------------------------------------------------------------
-- o1: trackable with phone 01711111111; o2: different phone.
INSERT INTO "Order"
 ("id","orderNumber","customerName","customerPhone","status","paymentStatus","paymentMethod","subtotal","discountTotal","shippingTotal","total","shippingAddress","courier","trackingNumber","createdAt","updatedAt") VALUES
 ('o1','SN100001','Test Customer','01711111111','SHIPPED','PAID','BKASH',3700,0,60,3760,'Dhaka','Steadfast','TRK-1','2026-02-10 00:00:00','2026-02-12 00:00:00'),
 ('o2','SN100002','Other Customer','01822222222','PENDING','COD_PENDING','COD',800,0,60,860,'Chittagong',NULL,NULL,'2026-02-11 00:00:00','2026-02-11 00:00:00');

INSERT INTO OrderItem ("id","orderId","productId","name","sku","imageUrl","unitPrice","quantity","total","options") VALUES
 ('oi1','o1','p1','Wireless Earbuds Pro','SKU-1','/products/earbuds-1.jpg',2500,1,2500,'{"Color":"Black"}'),
 ('oi2','o1','p3','Cotton T-Shirt','SKU-3','/products/tshirt.jpg',800,1,800,NULL),
 ('oi3','o2','p6','Scented Candle','SKU-6','/products/candle.jpg',700,1,700,NULL);

INSERT INTO OrderStatusHistory ("id","orderId","status","note","createdAt") VALUES
 ('sh1','o1','PENDING','Order placed','2026-02-10 00:00:00'),
 ('sh2','o1','CONFIRMED','Verified payment','2026-02-10 01:00:00'),
 ('sh3','o1','SHIPPED','On the way','2026-02-12 00:00:00'),
 ('sh4','o2','PENDING',NULL,'2026-02-11 00:00:00');
`;
