'use client';
import React from 'react';
import {BarChart,Bar,XAxis,YAxis,CartesianGrid,Tooltip,ResponsiveContainer} from 'recharts';
import {useUI} from './platform';
import type {Row} from '@/lib/gd';
export default function StatusChart({data}:{data:Row}){const {t}=useUI();return <ResponsiveContainer width="100%" height={230}><BarChart data={[{name:t('نشطة','Active'),value:data.active_molds||0},{name:t('غير نشطة','Inactive'),value:data.inactive_molds||0},{name:t('صيانة','Maintenance'),value:data.under_maintenance||0}]}><CartesianGrid vertical={false} stroke="#ededed"/><XAxis dataKey="name" axisLine={false} tickLine={false}/><YAxis allowDecimals={false} axisLine={false} tickLine={false}/><Tooltip/><Bar name={t('عدد الأسطمبات','Mold count')} dataKey="value" fill="#ED0715" radius={[4,4,0,0]} maxBarSize={48}/></BarChart></ResponsiveContainer>}
