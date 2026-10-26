import React,{useState} from 'react';
import {CircleHelp,ExternalLink} from 'lucide-react';
export const HELP_URL='https://fqxxzyw.github.io/Yukino-Companion/#help';
export default function ResourceHelp({api,topic='downloads',className=''}){
 const [error,setError]=useState('');
 async function open(){try{if(api?.openHelp)await api.openHelp(topic);else if(!api)window.open(HELP_URL,'_blank','noopener,noreferrer');else throw Error('请更新基础程序后打开帮助文档。');setError('')}catch(error){setError(error.message)}}
 return <div className={'resource-help '+className}><button type="button" className="text-link" onClick={open}><CircleHelp size={15}/>无法下载？寻求帮助 <ExternalLink size={13}/></button>{error&&<small role="alert">{error}</small>}</div>;
}
