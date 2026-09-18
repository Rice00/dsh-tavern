using System;
using System.IO;
using System.Drawing;
using System.Windows.Forms;

// The folder choice and its explanation stay on screen until explicitly accepted.
class SetupDialog : Form {
 readonly TextBox directory=new TextBox();
 public string InstallRoot { get { return Path.GetFullPath(directory.Text.Trim()); } }
 public SetupDialog(string initial,bool existing) {
  Text=existing?"修复 DSH Tavern 启动入口":"安装 DSH Tavern";
  ClientSize=new Size(600,300);AutoScaleMode=AutoScaleMode.Dpi;
  StartPosition=FormStartPosition.CenterParent;FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;MinimizeBox=false;
  var heading=new Label{Text=existing?"已找到原安装，将保留现有酒馆和数据。":"选择安装文件夹",AutoSize=false};
  heading.SetBounds(24,22,550,28);Controls.Add(heading);
  directory.SetBounds(24,60,444,26);directory.Text=initial;directory.ReadOnly=existing;Controls.Add(directory);
  var browse=new Button{Text="浏览…",Enabled=!existing};browse.SetBounds(480,58,96,30);Controls.Add(browse);
  browse.Click+=delegate{using(var picker=new FolderBrowserDialog{Description="选择用于存放 DSH Tavern 的文件夹",SelectedPath=directory.Text})if(picker.ShowDialog(this)==DialogResult.OK)directory.Text=Path.Combine(picker.SelectedPath,"DSH-Tavern");};
  var note=new Label{Text=existing?"将在原位置补建桌面和开始菜单快捷方式。\n原数据位置保持不变，本次不会迁移数据。":"程序、运行环境和新数据将存放在此文件夹。\n首次安装需要联网；Desktop 固定为 2.0.5。"};
  note.SetBounds(24,105,550,52);Controls.Add(note);
  var entry=new Label{Text="安装后：从桌面或开始菜单打开「DSH Tavern」。\n下载的安装包可以删除，已安装的启动入口会保留。"};
  entry.SetBounds(24,171,550,48);Controls.Add(entry);
  var cancel=new Button{Text="取消",DialogResult=DialogResult.Cancel};cancel.SetBounds(344,246,96,32);Controls.Add(cancel);CancelButton=cancel;
  var install=new Button{Text=existing?"修复并启动":"安装并启动"};install.SetBounds(454,246,122,32);Controls.Add(install);AcceptButton=install;
  install.Click+=delegate{
   try {
    if(string.IsNullOrWhiteSpace(directory.Text)||!Path.IsPathRooted(directory.Text.Trim()))throw new Exception("请输入完整的安装路径，例如 D:\\Apps\\DSH-Tavern。");
    string path=InstallRoot;
    if(path.TrimEnd('\\')==Path.GetPathRoot(path).TrimEnd('\\'))throw new Exception("请选择磁盘下的独立文件夹，不要直接选择盘符根目录。");
    Directory.CreateDirectory(path);
    string probe=Path.Combine(path,".write-check-"+Guid.NewGuid().ToString("N"));using(File.Create(probe)){}File.Delete(probe);
    DialogResult=DialogResult.OK;Close();
   } catch(Exception e){MessageBox.Show(this,"无法使用此安装位置："+e.Message,"DSH Tavern",MessageBoxButtons.OK,MessageBoxIcon.Warning);}
  };
 }
}
