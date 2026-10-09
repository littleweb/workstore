//! Private sync snapshots use compact byte strings; legacy numeric arrays remain readable.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{de::{MapAccess, SeqAccess, Visitor, Error}, ser::SerializeMap, Deserialize, Deserializer, Serialize, Serializer};
use std::{collections::BTreeMap, fmt};
struct Bytes(Vec<u8>);
impl<'de> Deserialize<'de> for Bytes {
    fn deserialize<D:Deserializer<'de>>(d:D)->Result<Self,D::Error> {
        struct ByteVisitor;
        impl<'de> Visitor<'de> for ByteVisitor {
            type Value=Bytes;
            fn expecting(&self,f:&mut fmt::Formatter)->fmt::Result{f.write_str("base64 bytes or legacy byte array")}
            fn visit_str<E:Error>(self,v:&str)->Result<Bytes,E>{
                let encoded=v.strip_prefix("b64:").ok_or_else(||E::custom("unknown sync byte encoding"))?;
                STANDARD.decode(encoded).map(Bytes).map_err(E::custom)
            }
            fn visit_seq<A:SeqAccess<'de>>(self,mut seq:A)->Result<Bytes,A::Error>{
                let mut bytes=Vec::new();while let Some(byte)=seq.next_element::<u8>()?{bytes.push(byte);}Ok(Bytes(bytes))
            }
        }
        d.deserialize_any(ByteVisitor)
    }
}
pub fn serialize<S:Serializer>(files:&BTreeMap<String,Vec<u8>>,s:S)->Result<S::Ok,S::Error>{
    struct Encoded<'a>(&'a [u8]);
    impl Serialize for Encoded<'_> {
        fn serialize<S:Serializer>(&self,s:S)->Result<S::Ok,S::Error>{s.serialize_str(&format!("b64:{}",STANDARD.encode(self.0)))}
    }
    let mut map=s.serialize_map(Some(files.len()))?;
    for(key,bytes)in files{map.serialize_entry(key,&Encoded(bytes))?;}map.end()
}
pub fn deserialize<'de,D:Deserializer<'de>>(d:D)->Result<BTreeMap<String,Vec<u8>>,D::Error>{
    struct FilesVisitor;
    impl<'de> Visitor<'de> for FilesVisitor {
        type Value=BTreeMap<String,Vec<u8>>;
        fn expecting(&self,f:&mut fmt::Formatter)->fmt::Result{f.write_str("sync files map")}
        fn visit_map<A:MapAccess<'de>>(self,mut map:A)->Result<Self::Value,A::Error>{
            let mut result=BTreeMap::new();while let Some((key,Bytes(bytes)))=map.next_entry::<String,Bytes>()?{result.insert(key,bytes);}Ok(result)
        }
    }
    d.deserialize_map(FilesVisitor)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Serialize,Deserialize)]
    struct Snapshot { #[serde(with="super")] files:BTreeMap<String,Vec<u8>> }
    #[test]
    fn legacy_arrays_and_compact_bytes_round_trip_exactly() {
        let legacy=br#"{"files":{"a":[0,255,128,1],"empty":[]}}"#;
        let snapshot:Snapshot=serde_json::from_slice(legacy).unwrap();
        let encoded=serde_json::to_vec(&snapshot).unwrap();
        assert!(std::str::from_utf8(&encoded).unwrap().contains("b64:"));
        let restored:Snapshot=serde_json::from_reader(std::io::Cursor::new(encoded)).unwrap();
        assert_eq!(restored.files,snapshot.files);
    }
    #[test]
    fn compact_binary_snapshot_is_small_and_unknown_encoding_is_rejected() {
        let bytes=vec![255;1024*1024];
        let snapshot=Snapshot{files:BTreeMap::from([("image".into(),bytes.clone())])};
        let encoded=serde_json::to_vec(&snapshot).unwrap();
        assert!(encoded.len()<bytes.len()*3/2);
        assert_eq!(serde_json::from_slice::<Snapshot>(&encoded).unwrap().files["image"],bytes);
        assert!(serde_json::from_slice::<Snapshot>(br#"{"files":{"a":"unknown"}}"#).is_err());
        assert!(serde_json::from_slice::<Snapshot>(br#"{"files":{"a":"b64:!"}}"#).is_err());
    }
}
