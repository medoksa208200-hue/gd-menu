-- Safe reference data only. NO staff accounts/passwords, fictitious sales,
-- products, production or maintenance events are created by default.
insert into public.company_settings(id) values(true) on conflict(id) do nothing;
insert into public.colors(name_ar,name_en,hex) values
('أبيض','White','#FFFFFF'),('أسود','Black','#080808'),('أحمر','Red','#ED0715')
on conflict(name_en) do nothing;
