-- Sample data so the app has something to render. Safe to re-run.
--
-- `type` uses the public.property_type enum from migration 0012
-- ('villa' | 'apartment' | 'room' | 'bnb') and `district` the
-- public.mogadishu_district enum from migration 0016.

insert into public.agents (id, name, email, avatar) values
  ('11111111-1111-1111-1111-111111111111', 'Natasha Wilson', 'natasha@restate.dev', 'https://i.pravatar.cc/150?img=5'),
  ('22222222-2222-2222-2222-222222222222', 'Marcus Reid',    'marcus@restate.dev',  'https://i.pravatar.cc/150?img=12')
on conflict (id) do nothing;

insert into public.properties
  (id, name, type, district, description, address, geolocation, price, area, bedrooms, bathrooms, rating, facilities, image, agent_id, rental_mode)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Modernica Apartment', 'apartment', 'hodan',
   'A bright corner apartment with floor-to-ceiling windows and a skyline view.',
   '224 Brooklyn Ave, New York', '40.7128,-74.0060', 16500, 2000, 4, 2, 4.8,
   '{Laundry,"Car Parking",Gym,Wifi}', 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800',
   '11111111-1111-1111-1111-111111111111', 'monthly'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Azure Villa', 'villa', 'wadajir',
   'Private villa with an infinity pool overlooking the bay.',
   '18 Coast Road, Santa Monica', '34.0195,-118.4912', 42000, 5400, 6, 5, 4.9,
   '{"Swimming pool",Gym,"Pet Center",Wifi}', 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800',
   '22222222-2222-2222-2222-222222222222', 'monthly'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Cedar Townhouse', 'villa', 'hamar_weyne',
   'Three-storey townhouse on a quiet tree-lined street, steps from the park.',
   '77 Cedar Lane, Portland', '45.5152,-122.6784', 9800, 1750, 3, 2, 4.4,
   '{Laundry,"Car Parking",Wifi}', 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800',
   '11111111-1111-1111-1111-111111111111', 'monthly'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'Kuro Studio', 'apartment', 'karan',
   'Compact studio with a bespoke kitchen and blackout glazing.',
   '4-2-1 Shibuya, Tokyo', '35.6595,139.7005', 5200, 620, 1, 1, 4.1,
   '{Wifi,Laundry}', 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800',
   '22222222-2222-2222-2222-222222222222', 'monthly'),
  -- One of each remaining category so every filter chip returns something.
  ('aaaaaaaa-0000-0000-0000-000000000005', 'Garden Room, Kilimani', 'room', 'hodan',
   'A private room in a shared house, with its own entrance onto the garden.',
   '12 Kilimani Road, Nairobi', '-1.2921,36.8219', 380, 220, 1, 1, 4.2,
   '{Wifi,Laundry,"Car Parking"}', 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=800',
   '11111111-1111-1111-1111-111111111111', 'monthly'),
  ('aaaaaaaa-0000-0000-0000-000000000006', 'Harbour View BnB', 'bnb', null,
   'Two-bedroom guesthouse a short walk from the harbour, breakfast included.',
   '9 Quay Street, Lisbon', '38.7223,-9.1393', 145, 900, 2, 2, 4.7,
   '{Wifi,Cutlery,"Swimming pool"}', 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800',
   '22222222-2222-2222-2222-222222222222', 'short_term')
on conflict (id) do nothing;

-- The insert above is `on conflict (id) do nothing`, so a database seeded
-- before migration 0016 keeps its null districts forever. Re-assert them here
-- so re-running the seed converges on the same fixture either way.
--
-- Five districts across four of them plus one deliberate NULL: enough spread
-- that the district filter returns different sets, and 'Harbour View BnB'
-- stays the proof that a listing with no district is still valid and still
-- shows up when no district filter is applied.
update public.properties p
set district = v.district::public.mogadishu_district
from (values
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'hodan'),
  ('aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'wadajir'),
  ('aaaaaaaa-0000-0000-0000-000000000003'::uuid, 'hamar_weyne'),
  ('aaaaaaaa-0000-0000-0000-000000000004'::uuid, 'karan'),
  ('aaaaaaaa-0000-0000-0000-000000000005'::uuid, 'hodan'),
  ('aaaaaaaa-0000-0000-0000-000000000006'::uuid, null)
) as v(id, district)
where p.id = v.id
  and p.district is distinct from v.district::public.mogadishu_district;

-- Every seeded property gets at least 2 gallery photos so the detail carousel
-- has something to swipe through. Guarded by NOT EXISTS on (property_id, image)
-- rather than ON CONFLICT: galleries has no unique key, so ON CONFLICT DO
-- NOTHING would duplicate every row on re-run. The 18-photo trigger from
-- migration 0012 is never approached here.
insert into public.galleries (property_id, image)
select v.property_id, v.image
from (values
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200'),
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1200'),
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=1200'),
  ('aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1200'),
  ('aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200'),
  ('aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1200'),
  ('aaaaaaaa-0000-0000-0000-000000000003'::uuid, 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200'),
  ('aaaaaaaa-0000-0000-0000-000000000003'::uuid, 'https://images.unsplash.com/photo-1583608205776-bfd35f0d9f83?w=1200'),
  ('aaaaaaaa-0000-0000-0000-000000000004'::uuid, 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200'),
  ('aaaaaaaa-0000-0000-0000-000000000004'::uuid, 'https://images.unsplash.com/photo-1502005229762-cf1b2da7c5d6?w=1200'),
  ('aaaaaaaa-0000-0000-0000-000000000005'::uuid, 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1200'),
  ('aaaaaaaa-0000-0000-0000-000000000005'::uuid, 'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=1200'),
  ('aaaaaaaa-0000-0000-0000-000000000006'::uuid, 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200'),
  ('aaaaaaaa-0000-0000-0000-000000000006'::uuid, 'https://images.unsplash.com/photo-1618773928121-c32242e63f39?w=1200')
) as v(property_id, image)
where exists (select 1 from public.properties p where p.id = v.property_id)
  and not exists (
    select 1 from public.galleries g
    where g.property_id = v.property_id and g.image = v.image
  );

-- Guarded by NOT EXISTS rather than ON CONFLICT: there is no unique key on
-- reviews, so ON CONFLICT DO NOTHING would happily insert duplicates on re-run.
insert into public.reviews (property_id, name, avatar, review, rating)
select v.property_id, v.name, v.avatar, v.review, v.rating
from (values
  ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'Charolette Hanlin', 'https://i.pravatar.cc/150?img=32',
   'The place was spotless and the view is exactly as pictured. Would stay again.', 4.8),
  ('aaaaaaaa-0000-0000-0000-000000000002'::uuid, 'Devon Lane', 'https://i.pravatar.cc/150?img=21',
   'Pool is the highlight. Slightly far from town but worth it.', 4.5),
  ('aaaaaaaa-0000-0000-0000-000000000006'::uuid, 'Ana Ferreira', 'https://i.pravatar.cc/150?img=45',
   'Breakfast was excellent and the harbour is two minutes away.', 4.7)
) as v(property_id, name, avatar, review, rating)
where exists (select 1 from public.properties p where p.id = v.property_id)
  and not exists (
    select 1 from public.reviews r
    where r.property_id = v.property_id and r.name = v.name
  );

-- ------------------------------------------------------------- marketplace
-- Furniture for sale (migration 0017). Enough spread that every screen has
-- something to render: approved items for the browse tab, a pending one for
-- the admin queue, and a rejected one so the seller's "my items" screen shows
-- a review note rather than an empty state nobody can explain.
--
-- `seller_id` holds auth.jwt()->>'sub' and is plain text, so these fixture ids
-- do not have to match a real auth user. They are constant, so re-running the
-- seed converges rather than accumulating sellers.
--
-- No JWT is present when the seed runs, so the status trigger from 0017 stands
-- aside and these rows may be inserted already approved.
insert into public.marketplace_items
  (id, seller_id, title, description, category, condition, price, negotiable,
   district, images, status, review_note)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'seed-seller-0001',
   'Three-seater fabric sofa',
   'Grey fabric sofa, four years old, no tears. Collection only.',
   'sofa', 'good', 180, true, 'hodan',
   '{"https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1200","https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?w=1200"}',
   'approved', null),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'seed-seller-0001',
   'Solid oak dining table',
   'Seats six. One scratch on the underside, otherwise as new.',
   'table', 'like_new', 320, false, 'hodan',
   '{"https://images.unsplash.com/photo-1577140917170-285929fb55b7?w=1200"}',
   'approved', null),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'seed-seller-0002',
   'Queen bed frame with slats',
   'Pine frame, mattress not included. Dismantled and ready to move.',
   'bed', 'good', 140, true, 'wadajir',
   '{"https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1200"}',
   'approved', null),
  ('bbbbbbbb-0000-0000-0000-000000000004', 'seed-seller-0002',
   'Office desk, height adjustable',
   'Electric sit-stand desk, 140x70. Works perfectly.',
   'office', 'like_new', 260, false, null,
   '{"https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=1200"}',
   -- Waiting on an admin: this is the row the approval tab exists for.
   'pending', null),
  ('bbbbbbbb-0000-0000-0000-000000000005', 'seed-seller-0002',
   'Two-door wardrobe',
   'Needs a new hinge.',
   'wardrobe', 'fair', 60, true, 'karan',
   '{"https://images.unsplash.com/photo-1595428774223-ef52624120d2?w=1200"}',
   -- A rejection the seller can actually read, per the contract: a silent
   -- rejection is indistinguishable from a bug.
   'rejected', 'Photos do not show the damage described. Please re-upload.')
on conflict (id) do nothing;

-- The private half. These phone numbers are the whole point of the two-table
-- split: no buyer can read this table, only the seller and an admin.
insert into public.marketplace_contacts (item_id, phone)
select v.item_id, v.phone
from (values
  ('bbbbbbbb-0000-0000-0000-000000000001'::uuid, '+252 61 000 0001'),
  ('bbbbbbbb-0000-0000-0000-000000000002'::uuid, '+252 61 000 0001'),
  ('bbbbbbbb-0000-0000-0000-000000000003'::uuid, '+252 61 000 0002'),
  ('bbbbbbbb-0000-0000-0000-000000000004'::uuid, '+252 61 000 0002'),
  ('bbbbbbbb-0000-0000-0000-000000000005'::uuid, '+252 61 000 0002')
) as v(item_id, phone)
where exists (select 1 from public.marketplace_items i where i.id = v.item_id)
on conflict (item_id) do nothing;
