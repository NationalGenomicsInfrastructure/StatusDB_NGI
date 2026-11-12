function (doc) {
    data={};
    data["id"] = doc.NGI_run_id;
    data["total_yield"] = 0;
    data["instrument"] ="";
    data["cver"] = "";
    data['lanes']=[];
    if("instrument_generated_files" in doc){
      if("RunParameters.json" in doc["instrument_generated_files"]){
        data["instrument"] = doc["instrument_generated_files"]["RunParameters.json"]["InstrumentName"];
        data["cver"] = doc["instrument_generated_files"]["RunParameters.json"]["KitConfiguration"]+ '_'+ doc["instrument_generated_files"]["RunParameters.json"]["ThroughputSelection"];
      }
      if("AvitiRunStats.json" in doc["instrument_generated_files"]){
        var aviti_run_stats = doc["instrument_generated_files"]["AvitiRunStats.json"];
        if("RunStats" in aviti_run_stats){
          if("TotalYield" in aviti_run_stats["RunStats"])
            data["total_yield"] = aviti_run_stats["RunStats"]["TotalYield"];
          if("PFCount" in aviti_run_stats["RunStats"])
            data["total_clusters"] = aviti_run_stats["RunStats"]["PFCount"];
        }
        if("LaneStats" in aviti_run_stats){
          var onelane=null;
          for (var lane in aviti_run_stats["LaneStats"]){
            laneobj={};
            onelane=aviti_run_stats["LaneStats"][lane];
            laneobj['lane']=onelane['Lane'];
            laneobj['total_yield']=onelane['TotalYield'];
            laneobj['total_clusters']=onelane['PFCount'];
            
            data['lanes'].push(laneobj);
          }
        }
      }
    }
    if ("NGI_run_id" in doc){
      emit(doc.NGI_run_id, data);
    }
  }